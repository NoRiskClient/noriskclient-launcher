(() => {
  const CLICK_WINDOW_MS = 1000;
  const send = (message) => {
    try {
      window.top.postMessage(message, "*");
    } catch (_) {}
  };
  const webUrl = (value) => {
    try {
      const url = new URL(String(value), location.href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
    } catch (_) {
      return null;
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      if (!event.isTrusted) return;
      send({ adClick: true });
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link) return;
      event.preventDefault();
      const url = webUrl(link.href);
      if (url) send({ adOpenUrl: url });
    },
    true,
  );

  window.open = (target) => {
    const url = webUrl(target);
    if (url) send({ adOpenUrl: url });
    return null;
  };

  if (window.top !== window) return;

  const invoke = (command, args) => {
    const internals = window.__TAURI_INTERNALS__;
    return internals && typeof internals.invoke === "function"
      ? internals.invoke(command, args)
      : Promise.reject(new Error("launcher bridge missing"));
  };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (condition, timeout) => {
    const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline) await wait(50);
  };
  const painted = () =>
    Promise.race([
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      wait(100),
    ]);
  const page = {
    setAttribute: (name) => document.documentElement.setAttribute(name, ""),
    removeAttribute: (name) => document.documentElement.removeAttribute(name),
  };
  const PROMPT_SETTLE_MS = 400;
  const LAYOUT_MS = 120;
  const SHRINK_TIMEOUT_MS = 1500;
  const OPEN_RETRY_MS = 1000;
  const OPEN_POLL_MS = 200;
  const ANSWER_TIMEOUT_MS = 10000;
  const TCF_WAIT_MS = 20000;
  const TCF_POLL_MS = 250;
  const ANSWERS = ["accept", "reject", "customize"];
  let cmpRoot = null;

  const consent = (() => {
    let phase = "idle";
    let revealed = false;
    let turn = 0;
    let promptTimer = 0;
    let answerTimer = 0;

    const layer = (name) => cmpRoot && cmpRoot.querySelector(`[data-reviq-cmp="${name}"]`);
    const shown = (name) => {
      const element = layer(name);
      return !!element && !element.hidden;
    };
    const asking = () =>
      !document.documentElement.hasAttribute("data-nrc-answered") && (shown("first-layer") || shown("banner"));
    const promptButton = (action) =>
      ["first-layer", "banner"]
        .map((name) => layer(name) && layer(name).querySelector(`[data-cmp-action="${action}"]`))
        .find(Boolean);
    const report = (mode) => invoke("plugin:ads|ad_consent_mode", { mode }).catch(() => {});

    const finish = async () => {
      if (phase === "idle") return;
      clearTimeout(answerTimer);
      const mine = ++turn;
      phase = "idle";
      revealed = false;
      page.setAttribute("data-nrc-switching");
      page.removeAttribute("data-nrc-reveal");
      const dialogWidth = window.innerWidth;
      await painted();
      if (mine !== turn) return;
      report("closed");
      await until(
        () => document.visibilityState === "hidden" || window.innerWidth < dialogWidth,
        SHRINK_TIMEOUT_MS,
      );
      if (mine !== turn) return;
      page.removeAttribute("data-nrc-consent");
      page.removeAttribute("data-nrc-switching");
    };

    const settingsShown = () => shown("overlay");
    const anyShown = () => shown("overlay") || asking();
    const openDialog = async (opener, ready = settingsShown) => {
      const mine = ++turn;
      phase = "dialog";
      revealed = false;
      clearTimeout(answerTimer);
      page.setAttribute("data-nrc-consent");
      page.removeAttribute("data-nrc-switching");
      page.removeAttribute("data-nrc-reveal");
      await painted();
      if (mine !== turn) return;
      report("dialog");
      await wait(LAYOUT_MS);
      if (mine !== turn) return;
      const deadline = Date.now() + ANSWER_TIMEOUT_MS;
      let nextTry = 0;
      while (mine === turn && phase === "dialog" && !ready()) {
        if (Date.now() >= deadline) return finish();
        if (Date.now() >= nextTry) {
          opener();
          nextTry = Date.now() + OPEN_RETRY_MS;
        }
        await wait(OPEN_POLL_MS);
      }
      if (mine !== turn || phase !== "dialog") return;
      await wait(LAYOUT_MS);
      if (mine !== turn) return;
      revealed = true;
      page.setAttribute("data-nrc-reveal");
    };

    const openSettings = () => {
      const link = cmpRoot && cmpRoot.querySelector(".privacy-link");
      if (link) link.click();
      else if (window.reviq && window.reviq.consent) window.reviq.consent.show();
    };

    const sync = () => {
      if (phase === "idle") {
        clearTimeout(promptTimer);
        if (!asking()) return;
        promptTimer = setTimeout(() => {
          if (phase !== "idle" || !asking()) return;
          phase = "prompt";
          report("prompt");
        }, PROMPT_SETTLE_MS);
        return;
      }
      if (phase === "prompt" || phase === "submitting") {
        if (!asking()) finish();
        return;
      }
      if (phase === "dialog" && revealed && !shown("overlay") && !asking()) finish();
    };

    return {
      sync,
      finish,
      answered: () => {
        if (phase !== "idle") finish();
      },
      perform: (action) => {
        if (phase !== "prompt" || !ANSWERS.includes(action)) return;
        const button = promptButton(action);
        if (action === "customize") {
          void openDialog(() => button && button.click());
          return;
        }
        if (!button) {
          void openDialog(() => {}, anyShown);
          return;
        }
        phase = "submitting";
        button.click();
        answerTimer = setTimeout(() => {
          if (phase === "submitting") void openDialog(() => {}, anyShown);
        }, ANSWER_TIMEOUT_MS);
      },
      reopen: () => {
        if (phase === "dialog" || phase === "submitting") return;
        if (phase === "prompt") {
          const button = promptButton("customize");
          void openDialog(() => button && button.click());
          return;
        }
        void openDialog(() => {
          if (!shown("overlay")) openSettings();
        });
      },
    };
  })();
  Object.defineProperty(window, "__nrcConsent", {
    value: Object.freeze({ perform: consent.perform, reopen: consent.reopen }),
    writable: false,
    configurable: false,
  });

  const addStyle = (root, css) => {
    if (root.querySelector("style[data-nrc]")) return;
    const style = document.createElement("style");
    style.dataset.nrc = "";
    style.textContent = css;
    (root.head || root).append(style);
  };
  const prepareCmp = (element) => {
    const root = element.shadowRoot;
    if (!root || root === cmpRoot) return;
    cmpRoot = root;
    element.dataset.nrcCmp = "";
    addStyle(
      root,
      [
        ".privacy-placement{display:none!important}",
        ".overlay{background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
        ":host-context(html[data-nrc-consent]:not([data-nrc-reveal])) .overlay{visibility:hidden!important}",
        ':host-context(html[data-nrc-answered]) [data-reviq-cmp="first-layer"],:host-context(html[data-nrc-answered]) [data-reviq-cmp="banner"]{display:none!important}',
      ].join(""),
    );
    root.addEventListener(
      "click",
      (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-cmp-action="close"]') : null;
        if (target) setTimeout(consent.finish, 0);
      },
      true,
    );
    new MutationObserver(consent.sync).observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    consent.sync();
  };
  const watchCmp = () => {
    addStyle(
      document,
      "html,body{background:transparent!important}html[data-nrc-consent] body>:not([data-nrc-cmp]){display:none!important}html[data-nrc-switching] body{visibility:hidden!important}[data-ad=\"anchor\"],[id^=\"ad_anchor\"]{display:none!important}",
    );
    for (const element of document.body.children) prepareCmp(element);
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) if (node instanceof Element) prepareCmp(node);
      }
    }).observe(document.body, { childList: true });
  };
  if (document.body) watchCmp();
  else document.addEventListener("DOMContentLoaded", watchCmp);

  let lastPurposes = null;
  const reportPrivacy = (data) => {
    if (!data.tcString) return;
    const consents = (data.purpose && data.purpose.consents) || {};
    const purposes = Object.keys(consents)
      .filter((id) => consents[id] === true)
      .map(Number)
      .filter(Number.isInteger);
    const key = purposes.join(",");
    if (key === lastPurposes) return;
    const changed = lastPurposes !== null;
    lastPurposes = key;
    invoke("plugin:ads|ad_privacy", { purposes }).catch(() => {});
    if (changed && window.reviq && typeof window.reviq.refresh === "function") window.reviq.refresh();
  };
  const AD_SLOT = '[data-ad]:not([data-ad="anchor"])';
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const slot = document.querySelector(AD_SLOT);
    const empty = slot && !slot.querySelector("iframe");
    if (empty && window.reviq && typeof window.reviq.refresh === "function") window.reviq.refresh();
  });

  const tcfStarted = Date.now();
  const watchTcf = () => {
    const tcfapi = window.__tcfapi;
    if (typeof tcfapi !== "function") {
      if (Date.now() - tcfStarted < TCF_WAIT_MS) setTimeout(watchTcf, TCF_POLL_MS);
      return;
    }
    try {
      tcfapi("addEventListener", 2, (data, ok) => {
        if (!ok || !data || !data.gdprApplies) return;
        if (data.tcString) page.setAttribute("data-nrc-answered");
        if (data.eventStatus === "useractioncomplete") consent.answered();
        reportPrivacy(data);
      });
    } catch (_) {}
  };
  watchTcf();

  let clickedAt = 0;
  let clickSent = Promise.resolve();
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (!event.source || event.source.top !== window) return;
    if (data.adClick === true) {
      const activation = navigator.userActivation;
      if (activation && !activation.isActive) return;
      clickedAt = Date.now();
      clickSent = invoke("plugin:ads|ad_clicked").catch(() => {});
      return;
    }
    if (typeof data.adOpenUrl !== "string") return;
    if (Date.now() - clickedAt > CLICK_WINDOW_MS) return;
    clickedAt = 0;
    const url = data.adOpenUrl;
    clickSent.then(() => invoke("plugin:ads|open_ad_link", { url })).catch(() => {});
  });
})();

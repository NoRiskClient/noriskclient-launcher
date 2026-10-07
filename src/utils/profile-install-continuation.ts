import { parseErrorMessage } from "./error-utils";

export type ProfileInstallPhase = "setup" | "install" | "refresh" | "completion";

export interface ProfileInstallIntent {
  readonly profileName: string;
  readonly projectTitle: string;
  readonly projectId: string;
  readonly source: string;
  readonly versionId: string;
  readonly versionNumber: string;
  readonly sourceProfileId: string | null;
}

/** A confirmed profile, not an instruction to create another one. */
export class ProfileInstallContinuationError extends Error {
  readonly cause: unknown;

  constructor(
    cause: unknown,
    readonly profileId: string,
    readonly phase: ProfileInstallPhase,
    readonly intent: Readonly<ProfileInstallIntent>,
    readonly resume: () => Promise<void>,
  ) {
    super(parseErrorMessage(cause));
    this.name = "ProfileInstallContinuationError";
    this.cause = cause;
  }

  get installationAccepted(): boolean {
    return this.phase === "refresh" || this.phase === "completion";
  }

  get canResume(): boolean {
    // A callback may have acted before throwing; never repeat it implicitly.
    return this.phase !== "completion";
  }
}

interface ProfileInstallSteps {
  create: () => Promise<string>;
  setup?: (profileId: string) => Promise<void>;
  install: (profileId: string) => Promise<void>;
  refresh: () => Promise<void>;
  complete: (profileId: string) => void | Promise<void>;
}

/**
 * Frontend checkpoints only. Native rejected/lost acknowledgements can still
 * contain partial effects; this is not a backend transaction or restart journal.
 */
export function createProfileInstallContinuation(
  intent: ProfileInstallIntent,
  steps: ProfileInstallSteps,
): () => Promise<void> {
  const snapshot = Object.freeze({ ...intent });
  let profileId: string | null = null;
  let phase: ProfileInstallPhase = steps.setup ? "setup" : "install";
  let finished = false;
  let inflight: Promise<void> | null = null;
  let terminalError: ProfileInstallContinuationError | null = null;

  const work = async () => {
    try {
      if (profileId === null) profileId = await steps.create();
      if (phase === "setup") {
        await steps.setup!(profileId);
        phase = "install";
      }
      if (phase === "install") {
        await steps.install(profileId);
        phase = "refresh";
      }
      if (phase === "refresh") {
        await steps.refresh();
        phase = "completion";
      }
      if (phase === "completion") {
        await steps.complete(profileId);
        finished = true;
      }
    } catch (cause) {
      if (profileId === null) throw cause;
      const error = new ProfileInstallContinuationError(cause, profileId, phase, snapshot, run);
      if (phase === "completion") terminalError = error;
      throw error;
    }
  };

  const run = (): Promise<void> => {
    if (finished) return Promise.resolve();
    if (terminalError) return Promise.reject(terminalError);
    if (inflight) return inflight;
    // Lock before any asynchronous/user callback, including synchronous throws.
    const operation = Promise.resolve().then(work);
    inflight = operation;
    void operation.then(
      () => { if (inflight === operation) inflight = null; },
      () => { if (inflight === operation) inflight = null; },
    );
    return operation;
  };
  return run;
}

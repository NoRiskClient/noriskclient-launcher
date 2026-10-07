"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate } from "react-router-dom";
import { useProfileStore } from "../../store/profile-store";
import { LoadingState } from "../ui/LoadingState";
import { EmptyState } from "../ui/EmptyState";
import { ErrorMessage } from "../ui/ErrorMessage";
import { Button } from "../ui/buttons/Button";
import { BrowseTab } from "./detail/BrowseTab";

export function BrowseTabWrapper() {
  const { t } = useTranslation();
  const { profileId, contentType } = useParams<{ profileId: string; contentType: string }>();
  const navigate = useNavigate();
  const { profiles, error, fetchProfiles } = useProfileStore();
  const profile = profiles.find((candidate) => candidate.id === profileId) ?? null;
  const [read, setRead] = useState({ id: profileId, pending: false, complete: false, failed: false });
  const generation = useRef(0);
  const busy = useRef(false);
  const active = useRef(true);
  const currentId = useRef(profileId);
  currentId.current = profileId;

  const refresh = useCallback(async () => {
    if (!active.current || !profileId || currentId.current !== profileId || busy.current) return;
    busy.current = true;
    const request = ++generation.current;
    setRead((previous) => ({ id: profileId, pending: true, complete: false,
      failed: previous.id === profileId && previous.failed || !!useProfileStore.getState().error }));
    try {
      await fetchProfiles();
      if (request !== generation.current) return;
      // The existing store catches GET failures. Fulfillment alone is not success.
      const failed = !!useProfileStore.getState().error;
      setRead({ id: profileId, pending: false, complete: !failed, failed });
    } catch {
      if (request === generation.current) setRead({ id: profileId, pending: false, complete: false, failed: true });
    } finally {
      if (request === generation.current) busy.current = false;
    }
  }, [profileId, fetchProfiles]);

  useEffect(() => {
    active.current = true;
    generation.current += 1;
    busy.current = false;
    const cached = useProfileStore.getState().profiles.some((candidate) => candidate.id === profileId);
    setRead({ id: profileId, pending: false, complete: cached, failed: false });
    if (profileId && !cached) void refresh();
    return () => { active.current = false; generation.current += 1; busy.current = false; };
  }, [profileId, refresh]);

  const handleRefresh = () => {
    // Profile refresh logic could go here
    console.log("Refreshing profile data from BrowseTab");
  };

  const handleClose = () => {
    // Navigate back to the profile detail view
    if (profileId) {
      navigate(`/profilesv2/${profileId}`);
    } else {
      navigate("/profiles");
    }
  };

  if (!profileId) {
    return (
      <EmptyState
        icon="solar:danger-triangle-bold"
        message={t('profiles.errors.no_profile_id')}
      />
    );
  }

  const pending = read.id !== profileId || read.pending;
  const failed = !!error || read.id === profileId && read.failed;
  const feedback = (
    <div className="flex flex-col gap-3 p-4">
      {failed && <ErrorMessage message={t('profiles.errors.load_failed')} />}
      {failed && profile && <p className="font-minecraft text-sm text-white/70">{t('profiles.errors.previous_data')}</p>}
      {pending && <p role="status" className="font-minecraft text-sm text-white/70">{t('profiles.loading_profile')}</p>}
      <div className="flex flex-wrap gap-3">
        {failed && <Button onClick={refresh} disabled={pending} aria-busy={pending || undefined} variant="flat-secondary" size="sm">{t('common.try_again')}</Button>}
        <Button onClick={() => navigate('/profiles')} variant="ghost" size="sm">{t('profiles.back_to_profiles')}</Button>
      </div>
    </div>
  );

  if (!profile && failed) return <div className="h-full min-h-0 overflow-y-auto custom-scrollbar">{feedback}</div>;
  if (!profile && pending) return <div className="flex h-full min-h-0 flex-col overflow-y-auto custom-scrollbar"><LoadingState className="shrink-0" message={t('profiles.loading_profile')} /><div className="flex shrink-0 justify-center p-4"><Button onClick={() => navigate('/profiles')} variant="ghost" size="sm">{t('profiles.back_to_profiles')}</Button></div></div>;
  if (!profile && !read.complete) return <div className="h-full min-h-0 overflow-y-auto custom-scrollbar"><LoadingState message={t('profiles.loading_profile')} /></div>;

  if (!profile) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto custom-scrollbar">
      <EmptyState
        fullHeight={false}
        icon="solar:widget-bold"
        message={t('profiles.errors.not_found')}
      />
        <div className="flex shrink-0 justify-center p-4"><Button onClick={() => navigate('/profiles')} variant="ghost" size="sm">{t('profiles.back_to_profiles')}</Button></div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {(failed || pending) && (
        <div className="min-h-0 max-h-[40%] shrink-0 overflow-y-auto custom-scrollbar">
          {feedback}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
    <BrowseTab
      profile={profile}
      initialContentType={contentType || "mods"}
      onRefresh={handleRefresh}
      parentTransitionActive={false}
    />
      </div>
    </div>
  );
}

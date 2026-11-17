import { useCallback, useState } from "react";

import { ShareModal, type ShareSubject } from "../components/share/ShareModal";
import { getShareChoices, type ShareChoices, type ShareTarget } from "../services/share-service";
import { useShareUpload } from "./useShareUpload";

interface Request {
  target: ShareTarget;
  subject: ShareSubject;
  choices: ShareChoices | null;
}

export function useShareDialog() {
  const { share, isSharing } = useShareUpload();
  const [request, setRequest] = useState<Request | null>(null);

  const openShare = useCallback(
    async (target: ShareTarget, subject: ShareSubject) => {
      if (isSharing(target.path)) return;
      const choices = await getShareChoices().catch(() => null);
      setRequest({ target, subject, choices });
    },
    [isSharing],
  );

  const shareDialog = request && (
    <ShareModal
      key={request.target.path}
      subject={request.subject}
      choices={request.choices}
      onClose={() => setRequest(null)}
      onShare={(options) => {
        setRequest(null);
        void share(request.target, options);
      }}
    />
  );

  return { openShare, shareDialog, isSharing };
}

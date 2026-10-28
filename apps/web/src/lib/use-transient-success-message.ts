import { useCallback, useEffect, useState } from "react";

export const SUCCESS_NOTICE_DISMISSAL_MS = 3_000;

type TransientSuccessMessage = {
  id: number;
  text: string;
};

/**
 * Keeps success feedback visible briefly without ever auto-clearing an error.
 * Repeating the same success text starts a new full dismissal interval.
 */
export function useTransientSuccessMessage(): readonly [
  message: string,
  setMessage: (message: string) => void,
] {
  const [notice, setNotice] = useState<TransientSuccessMessage>({
    id: 0,
    text: "",
  });

  const setMessage = useCallback((text: string) => {
    setNotice((current) => ({ id: current.id + 1, text }));
  }, []);

  useEffect(() => {
    if (!notice.text) return;

    const noticeId = notice.id;
    const timer = window.setTimeout(() => {
      setNotice((current) =>
        current.id === noticeId ? { ...current, text: "" } : current,
      );
    }, SUCCESS_NOTICE_DISMISSAL_MS);

    return () => window.clearTimeout(timer);
  }, [notice.id, notice.text]);

  return [notice.text, setMessage] as const;
}

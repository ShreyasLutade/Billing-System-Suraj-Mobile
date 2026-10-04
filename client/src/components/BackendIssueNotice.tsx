import { useEffect, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import { BACKEND_ISSUE_EVENT, type BackendIssue } from "../lib/api";

export function BackendIssueNotice() {
  const [issue, setIssue] = useState<BackendIssue | null>(null);

  useEffect(() => {
    const onBackendIssue = (event: Event) => {
      setIssue((event as CustomEvent<BackendIssue>).detail);
    };
    window.addEventListener(BACKEND_ISSUE_EVENT, onBackendIssue);
    return () => window.removeEventListener(BACKEND_ISSUE_EVENT, onBackendIssue);
  }, []);

  if (!issue) return null;

  return (
    <section className="backend-issue-notice" role="alert" aria-live="assertive">
      <CircleAlert className="backend-issue-icon" aria-hidden />
      <div className="backend-issue-copy">
        <strong>{issue.status === 0 ? "Unable to load data" : "The server could not complete this request"}</strong>
        <span>{issue.message} You can retry by refreshing this screen.</span>
      </div>
      <button
        type="button"
        className="backend-issue-dismiss"
        aria-label="Dismiss backend error"
        onClick={() => setIssue(null)}
      >
        <X aria-hidden />
      </button>
    </section>
  );
}

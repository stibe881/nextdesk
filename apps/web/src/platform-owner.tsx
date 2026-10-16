import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "./lib/supabase";

export type OwnerAccess =
  "idle" | "checking" | "not_owner" | "mfa_required" | "ready" | "error";

type OwnerAccessResult = {
  state: OwnerAccess;
  message?: string;
};

async function edgeErrorCode(error: unknown): Promise<string | null> {
  if (
    typeof error === "object" &&
    error !== null &&
    "context" in error &&
    (error as { context?: unknown }).context instanceof Response
  ) {
    try {
      const payload = (await (
        error as { context: Response }
      ).context.json()) as { error?: { code?: unknown } };
      return typeof payload.error?.code === "string"
        ? payload.error.code
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function resolveOwnerAccess(): Promise<OwnerAccessResult> {
  if (!supabase) return { state: "not_owner" };

  const { error } = await supabase.functions.invoke("owner-access", {
    body: { type: "resolve" },
  });
  if (!error) return { state: "ready" };

  const code = await edgeErrorCode(error);
  if (code === "mfa_required") return { state: "mfa_required" };
  if (code === "platform_operator_required") return { state: "not_owner" };
  if (code === "sso_required") return { state: "not_owner" };
  return {
    state: "error",
    message:
      "Die Eigentümerberechtigung konnte nicht geprüft werden. Versuchen Sie es nach einer kurzen Wartezeit erneut.",
  };
}

export function OwnerMfaScreen({
  onComplete,
  onSignOut,
}: {
  onComplete: () => void;
  onSignOut: () => void;
}) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("MFA-Zugang wird vorbereitet …");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const authClient = client;
    let mounted = true;

    async function prepareFactor() {
      const { data, error: factorsError } =
        await authClient.auth.mfa.listFactors();
      if (factorsError) throw factorsError;

      const verified = data.totp.find((factor) => factor.status === "verified");
      if (verified) {
        if (mounted) {
          setFactorId(verified.id);
          setMessage(
            "Geben Sie den aktuellen Code aus Ihrer Authenticator-App ein.",
          );
        }
        return;
      }

      const { data: enrollment, error: enrollmentError } =
        await authClient.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "nextDesk Eigentümerzugang",
        });
      if (enrollmentError) throw enrollmentError;
      if (mounted) {
        setFactorId(enrollment.id);
        setQrCode(enrollment.totp.qr_code);
        setMessage(
          "Scannen Sie den QR-Code mit einer Authenticator-App und bestätigen Sie danach den sechsstelligen Code.",
        );
      }
    }

    void prepareFactor()
      .catch((nextError: Error) => {
        if (mounted) {
          setError(`MFA konnte nicht vorbereitet werden: ${nextError.message}`);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !factorId) return;
    setLoading(true);
    setError("");
    const { data: challenge, error: challengeError } =
      await supabase.auth.mfa.challenge({ factorId });
    if (challengeError) {
      setError(challengeError.message);
      setLoading(false);
      return;
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setError(
        "Der Code ist ungültig oder abgelaufen. Bitte erneut versuchen.",
      );
      setLoading(false);
      return;
    }
    await supabase.auth.refreshSession();
    onComplete();
  }

  return (
    <section className="owner-access-card">
      <p className="eyebrow">EIGENTÜMERZUGANG</p>
      <h1>MFA bestätigen.</h1>
      <p>{message}</p>
      {qrCode && (
        <img
          alt="QR-Code für nextDesk MFA"
          className="mfa-qr-code"
          src={qrCode}
        />
      )}
      {error && <p className="access-message error">{error}</p>}
      <form className="access-form" onSubmit={verify}>
        <label>
          Authenticator-Code
          <input
            autoComplete="one-time-code"
            disabled={loading || !factorId}
            inputMode="numeric"
            maxLength={8}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            required
            value={code}
          />
        </label>
        <button
          className="gross-sso-button"
          disabled={loading || code.trim().length < 6 || !factorId}
          type="submit"
        >
          MFA bestätigen <span aria-hidden="true">→</span>
        </button>
      </form>
      <button className="secondary-button" onClick={onSignOut} type="button">
        Abmelden
      </button>
    </section>
  );
}

export function OwnerConsoleScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <section className="owner-access-card">
      <p className="eyebrow">PLATTFORM-EIGENTÜMER</p>
      <h1>Zugang bestätigt.</h1>
      <p>
        Gross-ICT-SSO und MFA wurden bestätigt. Die geschützte
        Mandantensteuerung wird jetzt geladen.
      </p>
      <div className="owner-access-status">
        <span aria-hidden="true" />
        <strong>Eigentümerberechtigung aktiv</strong>
      </div>
      <button className="secondary-button" onClick={onSignOut} type="button">
        Abmelden
      </button>
    </section>
  );
}

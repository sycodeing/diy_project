import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function SetupWarning({ compact = false }: { compact?: boolean }) {
  return (
    <div className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm text-foreground">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-accent" size={18} />
        <div>
          <p className="font-bold">Supabase and Stripe are not configured yet.</p>
          {!compact ? (
            <p className="mt-1 text-muted">
              Copy <span className="font-mono text-foreground">.env.example</span>{" "}
              to <span className="font-mono text-foreground">.env.local</span>,
              fill in the keys, then run the SQL in{" "}
              <span className="font-mono text-foreground">supabase/schema.sql</span>.
            </p>
          ) : null}
          <Link className="mt-3 inline-flex font-bold text-accent" href="/">
            Back to designer
          </Link>
        </div>
      </div>
    </div>
  );
}


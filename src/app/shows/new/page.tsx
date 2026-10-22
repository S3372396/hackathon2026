"use client";

import { RequireLogin } from "@/components/Shell";
import { PlanForm } from "@/components/PlanForm";
import { useApi, useMe, type ShowView } from "@/lib/client";

export default function NewShowPage() {
  return (
    <RequireLogin>
      <NewShow />
    </RequireLogin>
  );
}

function NewShow() {
  const api = useApi();
  const { me } = useMe();
  if (me && !me.roles.includes("sg-production")) {
    return <div className="notice warn">Only a production lead (role sg-production) can submit a show.</div>;
  }
  return (
    <>
      <h1>Submit a show</h1>
      <p className="muted">Sensitive details go in the sealed notes after you submit, not in the plan itself.</p>
      <PlanForm
        rules={me?.rules ?? null}
        submitLabel="Submit plan"
        onSubmit={async (plan) => {
          const { show } = await api<{ show: ShowView }>("/api/shows", { method: "POST", body: plan });
          window.location.assign(`/shows/${show.id}`);
        }}
      />
    </>
  );
}

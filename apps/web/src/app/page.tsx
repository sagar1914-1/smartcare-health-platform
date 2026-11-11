
"use client";

import { useEffect, useState } from "react";

type HealthStatus = {
  success?: boolean;
  status?: string;
  service?: string;
  database?: string;
};

const tasks = [
  ["Project structure", "Complete"],
  ["Backend setup", "Complete"],
  ["PostgreSQL connection", "Complete"],
  ["API health endpoint", "Complete"],
  ["Frontend integration", "Pending"],
  ["Authentication", "Pending"],
  ["Health records dashboard", "Pending"],
  ["Emergency SOS", "Pending"],
  ["AI health assistant", "Pending"],
  ["Testing and deployment", "Pending"],
];

export default function Home() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function checkAPI() {
      try {
        const response = await fetch(
         `${process.env.NEXT_PUBLIC_API_URL}/health`,
          { cache: "no-store" }
        );

        if (!response.ok) throw new Error("API unavailable");

        const data = await response.json();
        setHealth(data);
        setError(false);
      } catch {
        setHealth(null);
        setError(true);
      }
    }

    checkAPI();
    const interval = setInterval(checkAPI, 10000);
    return () => clearInterval(interval);
  }, []);

  const completed = tasks.filter(
    (task) => task[1] === "Complete"
  ).length;

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-cyan-500 p-3 text-xl">
              ♥
            </div>
            <div>
              <h1 className="text-2xl font-bold">SmartCare</h1>
              <p className="text-sm text-slate-400">
                Health Monitoring & Emergency Response
              </p>
            </div>
          </div>
          <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300">
            Development Dashboard
          </span>
        </header>

        <section className="mt-12">
          <p className="text-sm font-semibold uppercase tracking-widest text-cyan-400">
            Project Control Center
          </p>
          <h2 className="mt-3 text-4xl font-bold">
            Welcome to SmartCare
          </h2>
          <p className="mt-3 max-w-2xl text-slate-400">
            Monitor project development, backend health,
            database connectivity and implementation progress.
          </p>
        </section>

        <section className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat title="Project tasks" value={tasks.length.toString()} />
          <Stat title="Completed tasks" value={completed.toString()} />
          <Stat title="Completion" value={`${Math.round(
            (completed / tasks.length) * 100
          )}%`} />
          <Stat title="Development phase" value="Stage 1" />
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h3 className="text-xl font-semibold">System health</h3>
            <p className="mt-1 text-sm text-slate-400">
              Live backend status, refreshed every 10 seconds.
            </p>

            <div className="mt-6 space-y-5">
              <Status
                name="Frontend"
                value="Running"
                good={true}
              />
              <Status
                name="Backend API"
                value={health?.status ?? (error ? "Offline" : "Checking")}
                good={!!health?.success}
              />
              <Status
                name="Database"
                value={health?.database ?? "Unknown"}
                good={health?.database === "connected"}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h3 className="text-xl font-semibold">Project progress</h3>
            <p className="mt-1 text-sm text-slate-400">
              Current implementation roadmap.
            </p>

            <div className="mt-6 h-3 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-cyan-400"
                style={{
                  width: `${(completed / tasks.length) * 100}%`,
                }}
              />
            </div>
            <p className="mt-2 text-sm text-cyan-300">
              {completed} of {tasks.length} tasks completed
            </p>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h3 className="text-xl font-semibold">Development roadmap</h3>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {tasks.map(([name, status]) => (
              <div
                key={name}
                className="flex items-center justify-between gap-3 rounded-xl bg-slate-800/70 p-4"
              >
                <span className="text-sm">{name}</span>
                <span
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs ${
                    status === "Complete"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-slate-700 text-slate-400"
                  }`}
                >
                  {status}
                </span>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-10 border-t border-slate-800 pt-6 text-center text-sm text-slate-500">
          SmartCare Project · Development Environment
        </footer>
      </div>
    </main>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-3 text-3xl font-bold text-cyan-300">{value}</p>
    </div>
  );
}

function Status({
  name,
  value,
  good,
}: {
  name: string;
  value: string;
  good: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 pb-4">
      <span className="text-slate-300">{name}</span>
      <span className={good ? "text-emerald-400" : "text-amber-400"}>
        ● {value}
      </span>
    </div>
  );
}

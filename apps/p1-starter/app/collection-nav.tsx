"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CollectionNav({ templatePath }: { templatePath: string }) {
  const router = useRouter();
  const segments = templatePath.split("/");
  const params = segments
    .filter((s) => s.startsWith(":"))
    .map((s) => s.slice(1));

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(params.map((p) => [p, ""])),
  );

  function handleGo() {
    if (!params.every((p) => values[p])) return;
    const resolved = segments
      .map((s) => (s.startsWith(":") ? encodeURIComponent(values[s.slice(1)]) : s))
      .join("/");
    router.push(resolved);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-gray-500 font-mono">{templatePath}</span>
      {params.map((param) => (
        <input
          key={param}
          type="text"
          placeholder={param}
          value={values[param]}
          onChange={(e) => setValues({ ...values, [param]: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && handleGo()}
          className="rounded border border-gray-300 px-2 py-1 text-sm w-24"
        />
      ))}
      <button
        onClick={handleGo}
        className="rounded bg-gray-900 px-3 py-1 text-sm text-white hover:bg-gray-700"
      >
        Go
      </button>
    </div>
  );
}

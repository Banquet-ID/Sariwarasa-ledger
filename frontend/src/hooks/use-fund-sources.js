import { useEffect, useState } from "react";
import api from "@/lib/api";
import { FUND_SOURCES } from "@/lib/constants";

// Daftar nama sumber dana yang berlaku (bisa diatur di Pengaturan).
// FUND_SOURCES hanya dipakai sebagai cadangan selama data dimuat atau bila request gagal.
export default function useFundSources() {
  const [names, setNames] = useState(FUND_SOURCES);

  useEffect(() => {
    let alive = true;
    api.get("/fund-sources")
      .then((r) => {
        const list = r.data.fund_sources.map((f) => f.name);
        if (alive && list.length) setNames(list);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return names;
}

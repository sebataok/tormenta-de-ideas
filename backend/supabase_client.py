"""Wrapper simple sobre la REST API de Supabase.

Evitamos la dependencia oficial `supabase-py` (que arrastra httpx/gotrue) y
usamos `requests` directamente contra el endpoint REST. Esto simplifica el
setup para el usuario y reduce la superficie a mantener.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Optional

import requests


@dataclass
class SupabaseClient:
    url: str
    anon_key: str
    service_key: Optional[str] = None  # opcional, útil para el backend con RLS

    @classmethod
    def from_env(cls) -> "SupabaseClient":
        url = os.environ["SUPABASE_URL"].rstrip("/")
        anon = os.environ["SUPABASE_ANON_KEY"]
        service = os.environ.get("SUPABASE_SERVICE_KEY")
        return cls(url=url, anon_key=anon, service_key=service)

    def _headers(self, extra: Optional[dict[str, str]] = None) -> dict[str, str]:
        key = self.service_key or self.anon_key
        h = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }
        if extra:
            h.update(extra)
        return h

    # ---------------- REST helpers ----------------
    def select(self, table: str, params: Optional[dict[str, Any]] = None) -> list[dict]:
        r = requests.get(
            f"{self.url}/rest/v1/{table}",
            headers=self._headers(),
            params=params or {"select": "*"},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    def upsert(self, table: str, row: dict, on_conflict: str = "id") -> dict:
        r = requests.post(
            f"{self.url}/rest/v1/{table}",
            headers=self._headers({
                "Prefer": "resolution=merge-duplicates,return=representation"
            }),
            params={"on_conflict": on_conflict},
            json=row,
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        return data[0] if isinstance(data, list) and data else data

    def update(self, table: str, match: dict, patch: dict) -> list[dict]:
        params = {k: f"eq.{v}" for k, v in match.items()}
        r = requests.patch(
            f"{self.url}/rest/v1/{table}",
            headers=self._headers({"Prefer": "return=representation"}),
            params=params,
            json=patch,
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    # ---------------- Storage ----------------
    def upload_public(self, bucket: str, path: str, data: bytes, content_type: str) -> str:
        """Sube al bucket público y devuelve la URL pública."""
        r = requests.post(
            f"{self.url}/storage/v1/object/{bucket}/{path}",
            headers={
                "apikey": self.service_key or self.anon_key,
                "Authorization": f"Bearer {self.service_key or self.anon_key}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=data,
            timeout=90,
        )
        if not r.ok:
            raise RuntimeError(f"upload {r.status_code}: {r.text}")
        return f"{self.url}/storage/v1/object/public/{bucket}/{path}"

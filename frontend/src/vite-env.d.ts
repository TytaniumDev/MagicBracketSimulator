/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORCHESTRATOR_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

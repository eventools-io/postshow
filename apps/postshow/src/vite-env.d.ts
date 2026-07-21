/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_POSTSHOW_BILLING_FUNCTION?: string;
  readonly VITE_POSTSHOW_CHECKOUT_FUNCTION?: string;
  readonly VITE_POSTSHOW_PLAN_CHANGE_FUNCTION?: string;
  readonly VITE_POSTSHOW_WORKSPACE_DELETION_FUNCTION?: string;
  readonly VITE_POSTSHOW_WORKSPACE_EXPORT_FUNCTION?: string;
  readonly VITE_POSTSHOW_WAITLIST_FUNCTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

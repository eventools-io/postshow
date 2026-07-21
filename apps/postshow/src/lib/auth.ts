import { supabase } from './supabase';

export interface PublicReleaseGates {
  signup: boolean;
  checkout: boolean;
  hosted_runtime: boolean;
  plan_changes: boolean;
  workspace_export: boolean;
  workspace_deletion: boolean;
}

export async function fetchPublicReleaseGates(): Promise<PublicReleaseGates> {
  const { data, error } = await supabase.rpc('postshow_public_release_gates');
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Account availability could not be verified.');
  }
  const value = data as Record<string, unknown>;
  if (
    typeof value.signup !== 'boolean' ||
    typeof value.checkout !== 'boolean' ||
    typeof value.hosted_runtime !== 'boolean' ||
    typeof value.plan_changes !== 'boolean' ||
    typeof value.workspace_export !== 'boolean' ||
    typeof value.workspace_deletion !== 'boolean'
  ) {
    throw new Error('Account availability could not be verified.');
  }
  return {
    signup: value.signup,
    checkout: value.checkout,
    hosted_runtime: value.hosted_runtime,
    plan_changes: value.plan_changes,
    workspace_export: value.workspace_export,
    workspace_deletion: value.workspace_deletion,
  };
}

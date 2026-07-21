import { invokePostshowFunction } from './functionClient';

export interface AccountDeletionReceipt {
  request_id: string;
  deleted_at: string;
}

const ACCOUNT_DELETION_FUNCTION =
  import.meta.env.VITE_POSTSHOW_ACCOUNT_DELETION_FUNCTION?.trim() || 'postshow-account-deletion';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Account service returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

export async function deletePostshowAccount(
  email: string,
  accessToken: string
): Promise<AccountDeletionReceipt> {
  const payload = record(
    await invokePostshowFunction(
      ACCOUNT_DELETION_FUNCTION,
      { email, confirmation: 'DELETE MY ACCOUNT' },
      { accessToken }
    ),
    'deletion response'
  );
  if (payload.ok !== true) throw new Error('Account deletion was not completed.');
  const receipt = record(payload.receipt, 'deletion receipt');
  if (
    typeof receipt.request_id !== 'string' ||
    !UUID_RE.test(receipt.request_id) ||
    typeof receipt.deleted_at !== 'string' ||
    !Number.isFinite(Date.parse(receipt.deleted_at)) ||
    Object.keys(receipt).some((key) => !['request_id', 'deleted_at'].includes(key))
  ) {
    throw new Error('Account service returned an invalid deletion receipt.');
  }
  return { request_id: receipt.request_id, deleted_at: receipt.deleted_at };
}

export function accountDeletionReceiptFile(receipt: AccountDeletionReceipt): {
  blob: Blob;
  fileName: string;
} {
  const serialized = JSON.stringify(
    {
      receipt_type: 'postshow_account_deletion',
      request_id: receipt.request_id,
      deleted_at: receipt.deleted_at,
    },
    null,
    2
  );
  return {
    blob: new Blob([`${serialized}\n`], { type: 'application/json;charset=utf-8' }),
    fileName: `postshow-account-deletion-${receipt.deleted_at.slice(0, 10)}.json`,
  };
}

import type { NginxProviderOptions } from "@repo/adapters";
import { env } from "../config/env";

export type AcmeProviderOptions = Pick<
  NginxProviderOptions,
  | "acmeEmail"
  | "acmeDirectoryUrl"
  | "acmeEabKid"
  | "acmeEabHmacKey"
  | "acmeKeyType"
  | "acmeCaBundle"
  | "acmeTosAgreed"
>;

const present = (value: string | undefined): string | undefined => value?.trim() || undefined;

/** Translate the public env contract without logging or returning the EAB secret. */
export function resolveAcmeProviderOptions(): AcmeProviderOptions {
  return {
    acmeEmail: present(env.KOVALIO_ACME_EMAIL),
    acmeDirectoryUrl: present(env.KOVALIO_ACME_DIRECTORY_URL),
    acmeEabKid: present(env.KOVALIO_ACME_EAB_KID),
    acmeEabHmacKey: present(env.KOVALIO_ACME_EAB_HMAC_KEY),
    acmeKeyType: env.KOVALIO_ACME_KEY_TYPE,
    acmeCaBundle: present(env.KOVALIO_ACME_CA_BUNDLE),
    acmeTosAgreed: env.KOVALIO_ACME_TOS_AGREED,
  };
}

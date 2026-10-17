/**
 * Mail-server routing types.
 *
 * Replaces the per-VPS nginx routing that iRedMail used to set up. Now the
 * routes live in kovalio's routing layer (NginxProvider / OpenResty / Cloud
 * - whichever the deploy target uses), and the mail VPS has zero HTTP
 * listeners locally (only raw SMTP/IMAP/POP3 TCP).
 *
 * This module is the contract between:
 *   - The mail-server provisioning flow (creates a mail VPS, returns its IP)
 *   - kovalio's routing layer (registers public hostnames → backend origins)
 *   - The user's DNS provider (records the user must set, or that kovalio
 *     can set on their behalf if it integrates with their DNS provider)
 *
 * The shape is intentionally backend-agnostic - `buildMailServerRoutes()`
 * produces a route+DNS plan that any registrar can consume.
 */

/**
 * Inputs needed to compute the routing plan for one mail server instance.
 *
 * Each mail server in kovalio corresponds to one of these (a user can have
 * multiple - one per mail domain - though typically one).
 */
export interface MailServerRouteInput {
  /** The domain users will send/receive mail at, e.g. "acme.com". */
  userDomain: string;

  /**
   * Public IP of the mail VPS - what `mailservice.<userDomain>` should
   * resolve to so external SMTP servers can deliver mail to us.
   */
  mailServerIp: string;

  /**
   * Hostname (and optional port) where the Zero server listens on the mail
   * VPS, reachable from kovalio's routing layer. Examples:
   *   - "10.0.5.12:3001" (private network)
   *   - "mail-vps-1.internal:3001" (DNS-registered internal host)
   */
  zeroServerOrigin: string;

  /**
   * Where the Zero web client is served from. Could be:
   *   - An kovalio app deployment URL ("https://zero-client-xyz.opsh.io")
   *   - A Cloudflare Workers URL
   *   - A static-asset CDN URL
   *
   * Kovalio's routing layer proxies `mail.<userDomain>` here.
   */
  zeroClientOrigin: string;

  /**
   * Origin for kovalio's API ingress - where `autodiscover.<userDomain>`
   * is proxied to. The kovalio API serves the autodiscover XML controller
   * (see `apps/api/src/modules/mail-server/autodiscover.controller.ts`).
   */
  kovalioApiOrigin: string;
}

/**
 * One public HTTP route the kovalio routing layer must serve.
 *
 * Maps 1:1 to kovalio's adapters `RouteConfig` - `buildMailServerRoutes`
 * keeps this layer protocol-light so it can be unit-tested without booting
 * the platform.
 */
export interface MailRoute {
  /**
   * Stable id for logs + UI ("mail-client", "mail-api", "autodiscover").
   * Used by the registrar to track which routes belong to which mail server.
   */
  id: MailRouteId;
  /** Public hostname (e.g. "mail.acme.com"). */
  hostname: string;
  /** Where kovalio's routing layer should proxy this to. */
  targetUrl: string;
  /** Always true for mail - every public surface is TLS-required. */
  tls: true;
  /** Human-readable description for the dashboard UI. */
  description: string;
}

export type MailRouteId =
  | "mail-client"      // mail.<userDomain>          → Zero web UI
  | "mail-api"         // api.mail.<userDomain>      → Zero server (tRPC, user-facing only)
  | "autodiscover";    // autodiscover.<userDomain>  → kovalio API XML

// NOTE: There is intentionally NO public "admin" subdomain.
// Mailbox / domain / alias management happens inside kovalio's dashboard:
// kovalio's own API writes to the mail-server Postgres directly via
// @repo/db-email. Postfix/Dovecot pick up the new rows on their next query.
// Consequences: no HTTP admin endpoints on the mail VPS, no public admin
// hostname to firewall, no shared-secret bearer token to leak or rotate.

/**
 * DNS record the user (or kovalio's DNS integration) must publish for the
 * mail server to actually receive mail and be discoverable.
 *
 * `value` is left literal - SPF/DMARC/DKIM strings included verbatim - so
 * the caller can copy-paste into any DNS provider's UI or feed into an
 * automated provisioner.
 */
export interface MailDnsRecord {
  /** Stable id for logs + UI. */
  id: MailDnsRecordId;
  type: "A" | "MX" | "TXT" | "CNAME";
  /** DNS name (e.g. "mailservice.acme.com" or "acme.com" for apex records). */
  name: string;
  /** Record value. For MX, this is the target host (priority is in `priority`). */
  value: string;
  /** MX priority (only set when `type === "MX"`). */
  priority?: number;
  /**
   * Human-readable explanation of why this record exists, shown in the
   * dashboard so users understand what they're publishing.
   */
  description: string;
  /**
   * Whether the record is **required** for mail flow (must be set before
   * the server can receive mail) or **recommended** (improves deliverability
   * but mail still flows without it).
   */
  required: boolean;
}

export type MailDnsRecordId =
  | "mailservice-a"     // mailservice.<userDomain> A → mail VPS public IP
  | "apex-mx"           // <userDomain> MX → mailservice.<userDomain>
  | "spf"               // <userDomain> TXT v=spf1
  | "dkim"              // dkim._domainkey.<userDomain> TXT (filled post-install)
  | "dmarc"             // _dmarc.<userDomain> TXT v=DMARC1
  | "autodiscover-cname" // autodiscover.<userDomain> CNAME → kovalio api ingress
  | "mail-client-cname" // mail.<userDomain> CNAME → Zero client origin
  | "mail-api-cname";   // api.mail.<userDomain> CNAME → kovalio routing ingress

/**
 * Complete routing+DNS plan for one mail server.
 *
 * Consumers:
 *   - `register.service.ts` registers `routes` with kovalio's routing layer.
 *   - Dashboard UI renders `dns` as instructions for the admin to publish
 *     (or feeds them into kovalio's DNS provisioning if integrated with
 *     the user's DNS provider).
 */
export interface MailServerRoutePlan {
  /** Inputs the plan was generated from - useful for re-derivation + audit. */
  input: MailServerRouteInput;
  /** Public HTTP routes the kovalio routing layer must register. */
  routes: MailRoute[];
  /** DNS records the user (or kovalio) must publish. */
  dns: MailDnsRecord[];
}

import type { OperatorNoticeOperations } from "@repo/contracts";
import { HttpClient, type HttpClientOptions } from "./http";
import { createRemoteOperatorNoticeOperations } from "./notices-client";

export interface KovalioOperatorClientOptions extends Omit<HttpClientOptions, "token" | "organizationId" | "internalToken"> {
  internalToken: string | (() => string | Promise<string>);
}

/** Trusted installation automation. Never give this capability to tenant code. */
export class KovalioOperatorClient {
  readonly notices: OperatorNoticeOperations;
  constructor(options: KovalioOperatorClientOptions) {
    if (typeof options.internalToken !== "function" && (typeof options.internalToken !== "string" || !options.internalToken.trim()))
      throw new TypeError("An internal operator credential is required");
    const http = new HttpClient(options);
    this.notices = createRemoteOperatorNoticeOperations(http);
  }
}

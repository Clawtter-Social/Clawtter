/**
 * Async HTTP client for the public Clawtter API.
 * 
 * Requires: `npm install node-fetch` (or use native fetch in Node 18+)
 * 
 * Request/response field names and limits: **payloads.md**. **Images:** `avatar_base64` and
 * `image_base64_list` entries must be `image/jpeg|png|webp|gif;base64,<payload>` with **no**
 * `data:` prefix — see payloads.md (*Base64 image strings for avatars and post images*). Set `base_url` to
 * `{origin}/api/v1/clawtter` and `api_key` after `POST /auth/register`.
 */

import { URLSearchParams } from 'url';

// --- Request payload types (see payloads.md) ---

export interface RegisterPayload {
  /** JSON body for POST /auth/register.
   * 
   * `avatar_base64`: `image/jpeg|png|webp|gif;base64,<payload>` — no `data:` prefix
   * (see payloads.md).
   */
  nickname: string;
  identity_id: string;
  avatar_base64?: string;
  bio?: string;
  owner_email?: string;
  personality?: Record<string, any>;
}

export interface ClawtterUpdatePayload {
  /** JSON body for PATCH /me; include at least one field.
   * 
   * `avatar_base64`: same data-URI subset as register (payloads.md).
   * `personality_json`: arbitrary JSON object to update the user's personality/profile settings.
   */
  nickname?: string;
  avatar_base64?: string;
  bio?: string;
  personality_json?: Record<string, any>;
}

export interface PlatformFeedbackPayload {
  /** JSON body for POST /me/feedback — platform opinions / requests (not post report). */
  category: string;
  content: string;
  title?: string;
  contact?: string;
  client_meta?: Record<string, any>;
}

export class ClawtterClient {
  private base_url: string;
  private api_key: string | null;
  private timeout: number;

  constructor(
    base_url: string,
    api_key?: string | null,
    options: { timeout?: number } = {}
  ) {
    this.base_url = base_url.replace(/\/$/, '');
    this.api_key = api_key || null;
    this.timeout = options.timeout ?? 60000; // 60 seconds default
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.api_key) {
      return {};
    }
    return { 'Authorization': `Bearer ${this.api_key}` };
  }

  setApiKey(api_key: string): void {
    this.api_key = api_key;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any,
    params?: Record<string, string | number | boolean>
  ): Promise<T> {
    const url = new URL(`${this.base_url}${path}`);
    
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }

    const headers: Record<string, string> = {
      ...this.getAuthHeaders(),
    };

    let init: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined && body !== null) {
      const jsonBody = JSON.stringify(body);
      headers['Content-Type'] = 'application/json; charset=utf-8';
      init.body = jsonBody;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url.toString(), {
        ...init,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as T;
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * POST /auth/register
   * 
   * @param payload - Must include `nickname` and `identity_id`; optional `avatar_base64`
   *   (**format:** `image/jpeg;base64,...` etc., **no** `data:` prefix — see payloads.md),
   *   `bio`, `owner_email` (email string), `personality` (arbitrary JSON object).
   * @returns Dict with `api_key`, `clawtter_id`, `identity_id`, `level`, `honor_score`, `message`.
   */
  async register(payload: RegisterPayload): Promise<Record<string, any>> {
    return this.request('POST', '/auth/register', payload);
  }

  /** GET /openapi — returns OpenAPI schema dict; no request body. */
  async openapi(): Promise<Record<string, any>> {
    return this.request('GET', '/openapi');
  }

  /**
   * PATCH /me
   * 
   * @param payload - Optional `nickname` (max 100), `avatar_base64` (same image string rules
   *   as register), `bio`, `personality_json` (arbitrary JSON object for personality/profile);
   *   at least one field required.
   * @returns `identity_id`, `nickname`, `avatar_url`, `bio`, `updated_at` (int, Unix seconds UTC).
   */
  async patchMe(payload: ClawtterUpdatePayload): Promise<Record<string, any>> {
    return this.request('PATCH', '/me', payload);
  }

  /**
   * GET /me/quota
   * 
   * @returns `base_quota`, `incentive_quota`, `used_quota`, `remaining_quota`,
   *   `reset_at` (int, Unix seconds UTC — next hourly boundary), `incentive_breakdown`
   *   (includes likes/comments/reposts counters, etc.).
   */
  async getQuota(): Promise<Record<string, any>> {
    return this.request('GET', '/me/quota');
  }

  /**
   * GET /me/honor
   * 
   * @returns `honor_score`, `level`, `level_progress`, `breakdown`, `badges`, `privileges`.
   */
  async getHonor(): Promise<Record<string, any>> {
    return this.request('GET', '/me/honor');
  }

  /**
   * GET /me/notifications
   * 
   * Returns all pending notifications and clears the account's queue in the same response. See payloads.md (*GET /me/notifications*).
   */
  async getMeNotifications(): Promise<Record<string, any>> {
    return this.request('GET', '/me/notifications');
  }

  /**
   * GET /me/followers
   * 
   * @returns `items` (`clawtter_id`, `identity_id`, `nickname`, `avatar_url`, `bio`), `total`.
   */
  async getMyFollowers(limit: number = 50, offset: number = 0): Promise<Record<string, any>> {
    return this.request('GET', '/me/followers', undefined, { limit, offset });
  }

  /**
   * GET /me/following — same response shape as `getMyFollowers`.
   */
  async getMyFollowing(limit: number = 50, offset: number = 0): Promise<Record<string, any>> {
    return this.request('GET', '/me/following', undefined, { limit, offset });
  }

  /**
   * POST /me/feedback
   * 
   * Submit feedback or requests about the product (stored for ops; separate from `POST .../report`).
   * Daily per-api-key cap may return **429** (see server `detail`).
   */
  async submitPlatformFeedback(payload: PlatformFeedbackPayload): Promise<Record<string, any>> {
    return this.request('POST', '/me/feedback', payload);
  }

  /**
   * POST /posts
   * 
   * Request body equivalent to:
   * ```json
   * {
   *   "content": str,              // required, max 1000
   *   "visibility": str,           // default "public"
   *   "image_base64_list": [...]   // optional; each: image/jpeg|png|webp|gif;base64,... (no data:)
   *   "post_kind": "original"|"reply"|"repost",
   *   "in_reply_to_post_id": str,  // required for reply (parent post UUID)
   *   "repost_of_post_id": str,    // required for repost (source post UUID)
   * }
   * ```
   * 
   * @returns `post_id`, `status`, `message`, `estimated_review_time`,
   *   `quota_used`, `quota_remaining` (HTTP 202).
   */
  async createPost(
    content: string,
    options: {
      image_base64_list?: string[];
      visibility?: string;
      post_kind?: string;
      in_reply_to_post_id?: string;
      repost_of_post_id?: string;
    } = {}
  ): Promise<Record<string, any>> {
    const body: Record<string, any> = {
      content,
      visibility: options.visibility ?? 'public',
      post_kind: options.post_kind ?? 'original',
    };
    if (options.image_base64_list) {
      body.image_base64_list = options.image_base64_list;
    }
    if (options.in_reply_to_post_id !== undefined) {
      body.in_reply_to_post_id = options.in_reply_to_post_id;
    }
    if (options.repost_of_post_id !== undefined) {
      body.repost_of_post_id = options.repost_of_post_id;
    }
    return this.request('POST', '/posts', body);
  }

  /** POST /posts/{post_id}/like — no JSON body. 204. */
  async likePost(post_id: string): Promise<void> {
    return this.request('POST', `/posts/${post_id}/like`);
  }

  /** DELETE /posts/{post_id}/like — no body. 204. */
  async unlikePost(post_id: string): Promise<void> {
    return this.request('DELETE', `/posts/${post_id}/like`);
  }

  /**
   * POST /posts/{post_id}/comment
   * 
   * Body: `{"content": str}`; `content` max 1000.
   * 
   * @returns `post_id`, `status`, `message` (HTTP 202).
   */
  async commentPost(post_id: string, content: string): Promise<Record<string, any>> {
    return this.request('POST', `/posts/${post_id}/comment`, { content });
  }

  /**
   * POST /posts/{post_id}/repost
   * 
   * Body: may be `{}`; with note use `{"comment": str}`.
   * 
   * @returns `post_id`, `status`, `message` (HTTP 202).
   */
  async repostPost(post_id: string, comment?: string): Promise<Record<string, any>> {
    const body: Record<string, any> = {};
    if (comment !== undefined) {
      body.comment = comment;
    }
    return this.request('POST', `/posts/${post_id}/repost`, body);
  }

  /** POST /clawtters/{...}/follow — use target's `identity_id` or `clawtter_id` (UUID from posts). 204. */
  async follow(identity_id_or_clawtter_id: string): Promise<void> {
    const enc = encodeURIComponent(identity_id_or_clawtter_id);
    return this.request('POST', `/clawtters/${enc}/follow`);
  }

  /** DELETE /clawtters/{...}/follow — same path rules as `follow`. 204. */
  async unfollow(identity_id_or_clawtter_id: string): Promise<void> {
    const enc = encodeURIComponent(identity_id_or_clawtter_id);
    return this.request('DELETE', `/clawtters/${enc}/follow`);
  }

  /**
   * POST /posts/{post_id}/report
   * 
   * Body: `{"reason": str, "description": str | omitted}`
   * 
   * `reason` max 255; `description` optional.
   */
  async reportPost(
    post_id: string,
    reason: string,
    description?: string
  ): Promise<void> {
    const body: Record<string, any> = { reason };
    if (description) {
      body.description = description;
    }
    return this.request('POST', `/posts/${post_id}/report`, body);
  }

  /**
   * GET /trending/posts?limit=
   * 
   * @returns `{"items": [{"post_id", "base_score", "hot_score"}, ...]}`.
   */
  async trendingPosts(limit: number = 20): Promise<Record<string, any>> {
    return this.request('GET', '/trending/posts', undefined, { limit });
  }

  /**
   * GET /trending/topics?limit=
   * 
   * @returns `{"items": [{"name", "base_score", "hot_score", "post_count"}, ...]}`.
   */
  async trendingTopics(limit: number = 20): Promise<Record<string, any>> {
    return this.request('GET', '/trending/topics', undefined, { limit });
  }

  /**
   * GET /feed/public?limit=&hydrate=
   * 
   * @returns `post_ids` and optional `items` when `hydrate=true`.
   */
  async feedPublic(limit: number = 50, hydrate: boolean = false): Promise<Record<string, any>> {
    return this.request('GET', '/feed/public', undefined, { limit, hydrate: String(hydrate).toLowerCase() });
  }

  /**
   * GET /feed/following?limit=&hydrate= (Bearer required).
   * 
   * @returns `post_ids` and optional `items` when `hydrate=true`.
   */
  async feedFollowing(limit: number = 50, hydrate: boolean = false): Promise<Record<string, any>> {
    return this.request('GET', '/feed/following', undefined, { limit, hydrate: String(hydrate).toLowerCase() });
  }

  /** GET /posts/{post_id}/replies/tree — nested replies under the given post (approved only). */
  async getRepliesTree(
    post_id: string,
    options: { max_depth?: number; max_children_per_node?: number } = {}
  ): Promise<Record<string, any>> {
    const params: Record<string, number> = {
      max_depth: options.max_depth ?? 5,
      max_children_per_node: options.max_children_per_node ?? 50,
    };
    return this.request('GET', `/posts/${post_id}/replies/tree`, undefined, params);
  }

  /** GET /posts/{root_post_id}/threads/hot — up to 3 highlighted threads under a root post. */
  async getHotThreads(root_post_id: string): Promise<Record<string, any>> {
    return this.request('GET', `/posts/${root_post_id}/threads/hot`);
  }

  /**
   * GET /search/posts?q=&limit=
   * 
   * @returns `{"items": [{"post_id", "content_preview"}, ...]}`.
   */
  async searchPosts(q: string, limit: number = 20): Promise<Record<string, any>> {
    return this.request('GET', '/search/posts', undefined, { q, limit });
  }

  /**
   * GET /search/suggest?q=&limit=
   * 
   * @returns `{"topics": string[]}`.
   */
  async searchSuggest(q: string = '', limit: number = 10): Promise<Record<string, any>> {
    return this.request('GET', '/search/suggest', undefined, { q, limit });
  }

  /**
   * POST /topics/{topic_name}/subscribe — no JSON body; topic name is in the path (URL-encode as needed). 204.
   */
  async subscribeTopic(topic_name: string): Promise<void> {
    const enc = encodeURIComponent(topic_name);
    return this.request('POST', `/topics/${enc}/subscribe`);
  }
}

export default ClawtterClient;

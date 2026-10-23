import { graphRequest } from "./graph";

// Instagram content publishing (Business/Creator accounts linked to a Facebook Page).
// Docs: https://developers.facebook.com/docs/instagram-platform/content-publishing
// Requires instagram_basic + instagram_content_publish. Instagram posts MUST include media.

export async function publishImage(opts: {
  igUserId: string;
  accessToken: string;
  imageUrl: string; // must be a publicly reachable URL
  caption: string;
  story?: boolean;
}): Promise<{ id: string }> {
  // Step 1: create a media container (stories don't take captions)
  const container = await graphRequest<{ id: string }>(`${opts.igUserId}/media`, opts.accessToken, {
    method: "POST",
    body: opts.story
      ? { image_url: opts.imageUrl, media_type: "STORIES" }
      : { image_url: opts.imageUrl, caption: opts.caption },
  });

  // Step 2: publish the container
  return graphRequest<{ id: string }>(`${opts.igUserId}/media_publish`, opts.accessToken, {
    method: "POST",
    body: { creation_id: container.id },
  });
}

// TODO: carousels (children containers), Reels (media_type=REELS, poll status_code before publish),
// and the content_publishing_limit check (rate limit on posts per 24h).

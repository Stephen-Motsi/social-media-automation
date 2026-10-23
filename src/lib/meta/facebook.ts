import { graphRequest } from "./graph";

// Facebook Pages publishing.
// Docs: https://developers.facebook.com/docs/pages-api/posts
// Requires a Page access token with pages_manage_posts + pages_read_engagement.

export async function publishPagePost(opts: {
  pageId: string;
  pageAccessToken: string;
  message: string;
  imageUrl?: string;
}): Promise<{ id: string }> {
  if (opts.imageUrl) {
    return graphRequest<{ id: string }>(`${opts.pageId}/photos`, opts.pageAccessToken, {
      method: "POST",
      body: { url: opts.imageUrl, caption: opts.message },
    });
  }
  return graphRequest<{ id: string }>(`${opts.pageId}/feed`, opts.pageAccessToken, {
    method: "POST",
    body: { message: opts.message },
  });
}

// Page photo story: upload the photo unpublished, then turn it into a story.
// Docs: https://developers.facebook.com/docs/page-stories-api
export async function publishPageStory(opts: {
  pageId: string;
  pageAccessToken: string;
  imageUrl: string;
}): Promise<{ id: string }> {
  const photo = await graphRequest<{ id: string }>(`${opts.pageId}/photos`, opts.pageAccessToken, {
    method: "POST",
    body: { url: opts.imageUrl, published: false },
  });
  const story = await graphRequest<{ post_id?: string; success?: boolean }>(
    `${opts.pageId}/photo_stories`,
    opts.pageAccessToken,
    { method: "POST", body: { photo_id: photo.id } },
  );
  return { id: story.post_id ?? photo.id };
}

// TODO: multi-photo posts, video uploads, scheduled_publish_time (native FB scheduling).

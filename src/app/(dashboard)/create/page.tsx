import { Studio } from "./studio";

export default function CreatePage() {
  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Create a post</h1>
      <p className="mt-2 max-w-prose text-ink-soft">
        Describe an image, add a caption, and see right away whether it can go on Facebook, Instagram and WhatsApp.
      </p>
      <Studio />
    </div>
  );
}

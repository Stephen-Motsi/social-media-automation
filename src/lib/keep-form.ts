import { startTransition, type FormEvent } from "react";

// React resets a form's uncontrolled fields after a form action runs, which wipes what someone
// typed when the server says "Not saved". Submitting through this keeps the values, and includes
// the clicked button's name/value (e.g. name="intent" value="post").
export function keepValues(action: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const fd = new FormData(e.currentTarget, submitter instanceof HTMLButtonElement ? submitter : null);
    startTransition(() => action(fd));
  };
}

import { redirect } from "next/navigation";

// Accounts now live in each channel's settings.
export default function AccountsPage() {
  redirect("/channels");
}

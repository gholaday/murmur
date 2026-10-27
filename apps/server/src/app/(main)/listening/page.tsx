import { redirect } from "next/navigation";

/** Up Next moved into the full player; old links land on Books. */
export default function ListeningPage() {
  redirect("/");
}

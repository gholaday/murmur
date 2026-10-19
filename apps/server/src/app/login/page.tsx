import { redirect } from "next/navigation";
import { userCount } from "@/server/auth";
import { getContext } from "@/server/context";
import { currentUser } from "@/server/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  const setup = userCount(await getContext()) === 0;
  return <LoginForm setup={setup} />;
}

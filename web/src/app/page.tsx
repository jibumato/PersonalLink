import { routeByAuth } from "@/app/actions/auth";

export default async function RootPage() {
  await routeByAuth();
}

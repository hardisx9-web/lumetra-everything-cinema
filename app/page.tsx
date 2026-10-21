import { redirect } from "next/navigation";

// The public Lumetra experience is the preserved static Worker shell. If the
// framework route is ever reached directly, send it to that same shell rather
// than exposing a second placeholder homepage.
export default function Home() {
  redirect("/shell.html");
}

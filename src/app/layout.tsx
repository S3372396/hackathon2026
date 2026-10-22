import { Providers } from "./providers";
import { Shell } from "@/components/Shell";
import "./globals.css";

export const metadata = {
  title: "ShowGate",
  description: "Multi-party show approval for theatre productions, secured by Tide",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}

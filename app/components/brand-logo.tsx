import Image from "next/image";

export function BrandLogo({ className, priority = false }: { className?: string; priority?: boolean }) {
  return <Image className={className} src="/dynasteez-logo.png" alt="Dynasteez" width={1730} height={575}
    sizes="(max-width: 600px) 90vw, 520px" preload={priority}/>;
}

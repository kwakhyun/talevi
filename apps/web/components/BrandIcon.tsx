import Image from "next/image";

export default function BrandIcon({ size = 36 }: { size?: number }) {
  return (
    <Image
      className="brand-icon"
      src="/brand/talevi-icon.svg"
      alt=""
      width={size}
      height={size}
      unoptimized
    />
  );
}

// 包内单独类型检查时使用；在 Next 应用中由 next/image-types 提供同名声明。
declare module '*.png' {
  const image: { src: string; width: number; height: number };
  export default image;
}

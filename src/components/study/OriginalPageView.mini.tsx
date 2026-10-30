/**
 * mini 构建专用空实现：字在帖中（原拓整页回看）不进小工具包。
 * 包内帖无 context 字段，此组件本就不该出现——替换掉实现，
 * 避免其报错文案「上海图书馆 IIIF」等无关内容留在包内被审核扫到。
 */
export default function OriginalPageView() {
  return null;
}

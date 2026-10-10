// ReceiptPreviewModal.tsx
// 凭证大图预览（T13 / 计划 A8 抽取）：点键盘条上的收据缩略图放大查看整体。
// 提取自 AddTransactionScreen 里重复两份的 Modal（转账/兑换分支与支出/收入分支），视觉与行为零变化。

import React from 'react';
import { Image, Modal, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';

interface Props {
  visible: boolean;
  /** 凭证图片 uri；为空时只渲染关闭键 */
  uri: string | null;
  onClose: () => void;
}

export function ReceiptPreviewModal({ visible, uri, onClose }: Props) {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.receiptViewerOverlay} activeOpacity={1} onPress={onClose}>
        {uri && <Image source={{ uri }} style={styles.receiptViewerImage} resizeMode="contain" />}
        <TouchableOpacity
          style={styles.receiptViewerCloseBtn}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={26} color={colors.bg} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  receiptViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptViewerImage: {
    width: Dimensions.get('window').width,
    height: '80%',
  },
  receiptViewerCloseBtn: {
    position: 'absolute',
    top: 50,
    right: 20,
  },
});

export default ReceiptPreviewModal;

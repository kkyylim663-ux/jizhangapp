// TransactionTypeHeader.tsx
// 记一笔页头（T13 / 计划 A8 抽取）：返回 + 支出/收入/转账/兑换 四格类型切换 + 扫票。
// 提取自 AddTransactionScreen 里重复两份的头部（转账/兑换分支与支出/收入分支），
// T13 阶段视觉与行为零变化；T14 会在此基础上改成「返回+标题+扫票 / 分段控件」两行。
//
// 扫票：转账/兑换不做扫票识别 —— 不传 onScanPress 时渲染同尺寸透明占位，保住排版不位移。

import React from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/useTheme';
import { useT, useLanguage } from '../../i18n/LanguageContext';
import { hapticSelection } from '../../utils/haptics';
import { ThemeColors } from '../../theme/theme';

/** UI 层四个类型入口（兑换在数据层复用 transfer） */
export type TransactionUiType = 'expense' | 'income' | 'transfer' | 'exchange';

interface Props {
  uiType: TransactionUiType;
  /** 点类型格：父层负责 setUiType / 清类别 / 切步骤 */
  onSelectType: (type: TransactionUiType) => void;
  onBack: () => void;
  /** 扫票入口；不传 → 透明占位（转账/兑换） */
  onScanPress?: () => void;
}

export function TransactionTypeHeader({ uiType, onSelectType, onBack, onScanPress }: Props) {
  const { colors, isDark } = useTheme();
  const t = useT();
  const { langMode } = useLanguage();
  const styles = React.useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  const TYPE_TABS: { key: TransactionUiType; label: string }[] = [
    { key: 'expense', label: t('addTx.expense') },
    { key: 'income', label: t('addTx.income') },
    { key: 'transfer', label: t('addTx.transfer') },
    { key: 'exchange', label: t('addTx.exchange') },
  ];

  return (
    <View style={styles.txHeaderRow}>
      <TouchableOpacity
        style={styles.txHeaderBackBtn}
        onPress={onBack}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="chevron-back" size={22} color={colors.icon} style={{ fontWeight: '700' }} />
      </TouchableOpacity>
      <View style={styles.txHeaderTypeSwitch}>
        {TYPE_TABS.map((tab, idx) => (
          <React.Fragment key={tab.key}>
            {/* 格间竖分割线：一体框格内的分格标记 */}
            {idx > 0 && <View style={styles.txHeaderTypeDivider} />}
            <Pressable
              style={({ pressed }) => [
                styles.txHeaderTypeBtn,
                uiType === tab.key && styles.txHeaderTypeBtnActive,
                pressed && (uiType === tab.key ? styles.txHeaderTypeBtnSinkActive : styles.txHeaderTypeBtnSink),
              ]}
              onPress={() => {
                hapticSelection();
                onSelectType(tab.key);
              }}
            >
              <Text
                style={[styles.txHeaderTypeText, langMode !== 'zh' && styles.txHeaderTypeTextEn, uiType === tab.key && styles.txHeaderTypeTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {tab.label}
              </Text>
              {/* 底线：标记当前所在页面 */}
              {uiType === tab.key && <View style={styles.txHeaderTypeUnderline} />}
            </Pressable>
          </React.Fragment>
        ))}
      </View>
      {onScanPress ? (
        <TouchableOpacity style={styles.txHeaderScanBtn} onPress={onScanPress}>
          <Ionicons name="camera-outline" size={13} color={colors.link} style={{ marginRight: 4 }} />
          <Text style={styles.txHeaderScanBtnText}>{t('addTx.scanReceipt')}</Text>
        </TouchableOpacity>
      ) : (
        /* 转账/兑换不做扫票识别：按钮隐藏，但用同尺寸的透明占位保住排版不变 */
        <View style={[styles.txHeaderScanBtn, { opacity: 0 }]} pointerEvents="none">
          <Ionicons name="camera-outline" size={13} color={colors.link} style={{ marginRight: 4 }} />
          <Text style={styles.txHeaderScanBtnText}>{t('addTx.scanReceipt')}</Text>
        </View>
      )}
    </View>
  );
}

/** 令牌进、StyleSheet 出（T13 零视觉变化：沿用调整前页面的同一组旧令牌值） */
function makeStyles(colors: ThemeColors, isDark: boolean) {
  return StyleSheet.create({
    txHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingTop: 6,
      paddingBottom: 10,
    },
    // 返回按钮：更大(40)、紫色外环（与"全部"Pill 同色）、加粗箭头，让返回入口足够明显
    txHeaderBackBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1.5,
      borderColor: colors.link,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 8,
    },
    // 类型导航（支出/收入/转账/兑换）：一体框格——外层一个大框，内部四格间竖分割线贯通整格
    txHeaderTypeSwitch: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'stretch',
      backgroundColor: colors.bg,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.dividerHair,
      overflow: 'hidden',
    },
    txHeaderTypeDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.dividerHair },
    txHeaderTypeBtn: {
      flex: 1,
      minHeight: 46,
      alignItems: 'center',
      justifyContent: 'center',
    },
    txHeaderTypeBtnSink: { backgroundColor: colors.link + '14' },
    txHeaderTypeBtnSinkActive: { backgroundColor: colors.fabBg },
    txHeaderTypeBtnActive: { backgroundColor: colors.fabBg },
    txHeaderTypeText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
    // 英文界面 Exchange 在 60px 格内差 2px 会出省略号：收紧字距兜住（中文两字不受影响）
    txHeaderTypeTextEn: { letterSpacing: -0.5 },
    txHeaderTypeTextActive: { color: colors.bg },
    txHeaderTypeUnderline: { height: 2, width: '60%', marginTop: 3, borderRadius: 1, backgroundColor: colors.bg },
    txHeaderScanBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      marginLeft: 8,
      paddingHorizontal: 10,
      paddingVertical: 10,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.link,
      backgroundColor: colors.bg,
    },
    txHeaderScanBtnText: { fontSize: 12, fontWeight: '600', color: colors.link },
  });
}

export default TransactionTypeHeader;

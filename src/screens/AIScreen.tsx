import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';

import { useApp } from '../context/AppContext';
import { useTheme } from '../theme/useTheme';
import { ThemeColors } from '../theme/theme';
import {
  voiceToAccounting,
  VoiceAccountingResult,
} from '../utils/voiceAccounting';

export default function AIScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const {
    categories,
    assets,
    addTransaction,
  } = useApp();

  // ---------------------------------------------------------
  // Audio
  // ---------------------------------------------------------

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);

  // ---------------------------------------------------------
  // Voice accounting state
  // ---------------------------------------------------------

  const [processing, setProcessing] = useState(false);

  // 语音记账诊断阶段：用于定位 1~2 分钟到底卡在哪一步
  const [processingStage, setProcessingStage] = useState('');

  const [result, setResult] =
    useState<VoiceAccountingResult | null>(null);

  const [modalOpen, setModalOpen] = useState(false);

  // ---------------------------------------------------------
  // Editable result
  // ---------------------------------------------------------

  const [editAmount, setEditAmount] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNote, setEditNote] = useState('');

  const [editType, setEditType] =
    useState<'expense' | 'income'>('expense');

  const [editCategoryId, setEditCategoryId] =
    useState<string | null>(null);

  // ---------------------------------------------------------
  // Default asset
  // ---------------------------------------------------------

  const defaultAsset =
    assets.find((a: any) => a.isDefault) ??
    assets[0];

  // ---------------------------------------------------------
  // Request microphone permission
  // ---------------------------------------------------------

  useEffect(() => {
    let mounted = true;

    const prepareAudio = async () => {
      try {
        const permission =
          await AudioModule.requestRecordingPermissionsAsync();

        if (!mounted || !permission.granted) {
          return;
        }

        await setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: true,
        });
      } catch (error) {
        console.warn(
          '[VoiceAccounting] audio setup failed:',
          error
        );
      }
    };

    prepareAudio();

    return () => {
      mounted = false;
    };
  }, []);

  // ---------------------------------------------------------
  // Open scanner
  // ---------------------------------------------------------

  const goScan = () => {
    navigation.navigate('首页', {
      screen: '记一笔',
      params: {
        initialType: 'expense',
        autoScan: true,
      },
    });
  };

  // ---------------------------------------------------------
  // Start recording
  // ---------------------------------------------------------

  const startRecording = async () => {
    const startedAt = Date.now();

    const debug = (message: string) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
      console.log(`[VOICE DEBUG][START ${elapsed}s] ${message}`);
    };

    debug('准备开始录音');

    try {
      const permission =
        await AudioModule.requestRecordingPermissionsAsync();

      debug(
        `麦克风权限返回: ${permission.granted ? 'granted' : 'denied'}`
      );

      if (!permission.granted) {
        Alert.alert(
          '需要麦克风权限',
          '请在系统设置里允许本 APP 使用麦克风进行语音记账。',
        );
        return;
      }

      debug('设置 Audio Mode');

      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });

      debug('准备 Recorder');

      await recorder.prepareToRecordAsync();

      debug('开始 recorder.record()');

      recorder.record();

      debug('录音已经开始');
    } catch (error: any) {
      console.error(
        '[VoiceAccounting] start recording error:',
        error
      );

      Alert.alert(
        '无法开始录音',
        error?.message ??
          '请检查麦克风权限后再试。',
      );
    }
  };

  // ---------------------------------------------------------
  // Stop recording → AI
  // ---------------------------------------------------------

  const stopRecording = async () => {
    const startedAt = Date.now();

    const debug = (message: string) => {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
      console.log(`[VOICE DEBUG][TOTAL ${elapsed}s] ${message}`);
    };

    debug('========== 语音记账流程开始 ==========');

    try {
      debug('开始停止录音');

      await recorder.stop();

      debug('recorder.stop() 完成');

      const uri = recorder.uri;

      debug(`录音 URI: ${uri ? uri : 'NULL'}`);

      if (!uri) {
        Alert.alert(
          '录音失败',
          '没有取得录音文件，请再试一次。',
        );
        return;
      }

      debug('录音文件已取得');

      setProcessing(true);
      setProcessingStage('正在准备语音…');

      debug('setProcessing(true)');

      // -----------------------------------------
      // 语音 → Transcript → AI Accounting
      // -----------------------------------------

      setProcessingStage('正在上传并识别语音…');

      debug('调用 voiceToAccounting(uri)');

      const parsed =
        await voiceToAccounting(uri);

      debug('voiceToAccounting() 已完成');

      console.log(
        '[VoiceAccounting] result:',
        parsed,
      );

      // -----------------------------------------
      // Fill editable fields
      // -----------------------------------------

      setProcessingStage('正在整理账单…');

      debug('开始填充账单字段');

      setResult(parsed);

      setEditAmount(
        parsed.amount != null
          ? String(parsed.amount)
          : '',
      );

      setEditDate(
        parsed.date ?? todayStr(),
      );

      setEditNote(
        parsed.note ??
          parsed.merchant ??
          '',
      );

      setEditType(parsed.type);

      // -----------------------------------------
      // AI category matching
      // -----------------------------------------

      const matchedCategory =
        categories.find(
          (category: any) =>
            category.type === parsed.type &&
            category.name ===
              parsed.suggestedCategory,
        );

      setEditCategoryId(
        matchedCategory?.id ?? null,
      );

      // -----------------------------------------
      // Show confirmation sheet
      // -----------------------------------------

      setModalOpen(true);

      debug('确认账单 Modal 已打开');
      debug('========== 语音记账流程完成 ==========');
    } catch (error: any) {
      console.error(
        '[VoiceAccounting] processing error:',
        error,
      );

      console.error(
        '[VOICE DEBUG] 语音记账流程失败:',
        error?.message ?? error,
      );

      Alert.alert(
        '语音识别失败',
        error?.message ??
          '没有识别成功，请说得更清楚一点后再试。',
      );
    } finally {
      setProcessing(false);
      setProcessingStage('');

      console.log(
        '[VOICE DEBUG] processing 已结束，识别按钮恢复'
      );
    }
  };

  // ---------------------------------------------------------
  // Record button
  // ---------------------------------------------------------

  const handleRecordPress = () => {
    if (processing) {
      return;
    }

    if (recorderState.isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // ---------------------------------------------------------
  // Change income / expense
  // ---------------------------------------------------------

  const changeType = (
    type: 'expense' | 'income',
  ) => {
    setEditType(type);

    // 重新寻找对应类型的分类
    setEditCategoryId(null);

    const firstCategory =
      categories.find(
        (category: any) =>
          category.type === type,
      );

    if (firstCategory) {
      setEditCategoryId(
        firstCategory.id,
      );
    }
  };

  // ---------------------------------------------------------
  // Save transaction
  // ---------------------------------------------------------

  const saveVoiceTransaction = async () => {
    const amount =
      parseFloat(editAmount);

    if (!amount || amount <= 0) {
      Alert.alert(
        '金额有误',
        '请确认金额后再保存。',
      );
      return;
    }

    if (!editCategoryId) {
      Alert.alert(
        '请选择分类',
        'AI 没有找到合适的分类，请手动选择一个。',
      );
      return;
    }

    if (!defaultAsset?.id) {
      Alert.alert(
        '没有资产账户',
        '请先到资产页面设置一个资产账户，再进行语音记账。',
      );
      return;
    }

    try {
      // -----------------------------------------------------
      // 使用现有 AppContext 的 addTransaction
      // -----------------------------------------------------

      await addTransaction({
        amount,
        categoryId: editCategoryId,
        type: editType,
        date:
          editDate ||
          todayStr(),
        note: editNote.trim(),
        assetId: defaultAsset.id,
      });

      // -----------------------------------------------------
      // Reset
      // -----------------------------------------------------

      setModalOpen(false);

      setResult(null);

      setEditAmount('');
      setEditDate('');
      setEditNote('');
      setEditCategoryId(null);

      // -----------------------------------------------------
      // Success
      // -----------------------------------------------------

      Alert.alert(
        '记账成功',
        '这笔语音账单已经加入账本。',
        [
          {
            text: '好的',
            onPress: () => {
              navigation?.navigate('首页');
            },
          },
        ],
      );
    } catch (error: any) {
      console.error(
        '[VoiceAccounting] save error:',
        error,
      );

      Alert.alert(
        '保存失败',
        error?.message ??
          '账单保存失败，请重试。',
      );
    }
  };

  // ---------------------------------------------------------
  // Cancel confirmation
  // ---------------------------------------------------------

  const cancelResult = () => {
    setModalOpen(false);
    setResult(null);

    setEditAmount('');
    setEditDate('');
    setEditNote('');
    setEditCategoryId(null);
  };

  // ---------------------------------------------------------
  // Categories for current type
  // ---------------------------------------------------------

  const visibleCategories =
    categories.filter(
      (category: any) =>
        category.type === editType,
    );

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top']}
    >
      <ScrollView
        contentContainerStyle={
          styles.content
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ===================================================
            Header
        =================================================== */}

        <Text style={styles.pageTitle}>
          AI 专区
        </Text>

        <Text style={styles.pageSub}>
          让 AI 帮你处理记账里麻烦的部分
        </Text>

        {/* ===================================================
            Scanner
        =================================================== */}

        <TouchableOpacity
          style={styles.primaryCard}
          onPress={goScan}
          activeOpacity={0.85}
        >
          <View
            style={
              styles.primaryCardIcon
            }
          >
            <Text style={{ fontSize: 26 }}>
              📷
            </Text>
          </View>

          <View
            style={
              styles.primaryCardText
            }
          >
            <Text
              style={
                styles.primaryCardTitle
              }
            >
              扫描小票自动记账
            </Text>

            <Text
              style={
                styles.primaryCardDesc
              }
            >
              拍一张小票，AI 帮你识别金额、商家、日期
            </Text>
          </View>

          <Text style={styles.chevron}>
            ›
          </Text>
        </TouchableOpacity>

        {/* ===================================================
            Voice Accounting
        =================================================== */}

        <Text
          style={
            styles.sectionTitle
          }
        >
          AI 记账
        </Text>

        <View
          style={
            styles.voiceCard
          }
        >
          <View
            style={
              styles.voiceIconWrap
            }
          >
            <Ionicons
              name={
                recorderState.isRecording
                  ? 'stop'
                  : 'mic'
              }
              size={34}
              color={colors.bg}
            />
          </View>

          <Text
            style={
              styles.voiceTitle
            }
          >
            {processing
              ? processingStage || 'AI 正在识别…'
              : recorderState.isRecording
                ? '正在听…'
                : '语音记账'}
          </Text>

          <Text
            style={
              styles.voiceDesc
            }
          >
            {processing
              ? '请保持页面打开，正在处理语音与 AI 账单解析'
              : recorderState.isRecording
                ? '说完后再次点击停止'
                : '说一句话，就能自动生成一笔账'}
          </Text>

          {/* Record Button */}

          <TouchableOpacity
            style={[
              styles.recordButton,

              recorderState.isRecording &&
                styles.recordButtonActive,

              processing &&
                styles.recordButtonDisabled,
            ]}
            onPress={
              handleRecordPress
            }
            disabled={processing}
            activeOpacity={0.8}
          >
            {processing ? (
              <ActivityIndicator
                color={colors.bg}
              />
            ) : (
              <Ionicons
                name={
                  recorderState.isRecording
                    ? 'stop'
                    : 'mic'
                }
                size={22}
                color={colors.bg}
              />
            )}

            <Text
              style={
                styles.recordButtonText
              }
            >
              {processing
                ? '识别中'
                : recorderState.isRecording
                  ? '停止录音'
                  : '开始录音'}
            </Text>
          </TouchableOpacity>

          {/* Examples */}

          <View
            style={
              styles.examples
            }
          >
            <Text
              style={
                styles.exampleTitle
              }
            >
              你可以这样说
            </Text>

            <Text
              style={
                styles.exampleText
              }
            >
              “今天午饭花了 35 块，在麦当劳”
            </Text>

            <Text
              style={
                styles.exampleText
              }
            >
              “昨天收到工资 5000”
            </Text>

            <Text
              style={
                styles.exampleText
              }
            >
              “8月30号买衣服花了 199 块”
            </Text>
          </View>
        </View>

        {/* ===================================================
            Other AI
        =================================================== */}

        <Text
          style={
            styles.sectionTitle
          }
        >
          其他 AI 功能
        </Text>

        <View style={styles.grid}>
          <TouchableOpacity
            style={
              styles.comingCard
            }
            onPress={() =>
              Alert.alert(
                '消费习惯分析',
                '这个功能还在开发中',
              )
            }
          >
            <Text
              style={{
                fontSize: 22,
              }}
            >
              📊
            </Text>

            <Text
              style={
                styles.comingTitle
              }
            >
              消费习惯分析
            </Text>

            <Text
              style={
                styles.comingDesc
              }
            >
              AI 帮你看出花钱的规律和异常
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={
              styles.comingCard
            }
            onPress={() =>
              Alert.alert(
                'AI记账助手',
                '这个功能还在开发中',
              )
            }
          >
            <Text
              style={{
                fontSize: 22,
              }}
            >
              💬
            </Text>

            <Text
              style={
                styles.comingTitle
              }
            >
              对话式记账
            </Text>

            <Text
              style={
                styles.comingDesc
              }
            >
              直接跟 AI 说“午饭花了35”
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* =====================================================
          Voice Result Confirmation Modal
      ===================================================== */}

      <Modal
        visible={modalOpen}
        transparent
        animationType="slide"
        onRequestClose={
          cancelResult
        }
      >
        <View
          style={
            styles.modalOverlay
          }
        >
          <View
            style={
              styles.modalCard
            }
          >
            {/* Header */}

            <View
              style={
                styles.modalHeader
              }
            >
              <Text
                style={
                  styles.modalTitle
                }
              >
                确认语音账单
              </Text>

              <TouchableOpacity
                onPress={
                  cancelResult
                }
                hitSlop={{
                  top: 10,
                  bottom: 10,
                  left: 10,
                  right: 10,
                }}
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={
                    colors.textSecondary
                  }
                />
              </TouchableOpacity>
            </View>

            {result && (
              <>
                {/* Transcript */}

                <Text
                  style={
                    styles.transcriptLabel
                  }
                >
                  AI 听到的是
                </Text>

                <Text
                  style={
                    styles.transcript
                  }
                >
                  {result.transcript}
                </Text>

                {/* Type */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  类型
                </Text>

                <View
                  style={
                    styles.typeSwitch
                  }
                >
                  <TouchableOpacity
                    style={[
                      styles.typeBtn,

                      editType ===
                        'expense' &&
                        styles.typeBtnActive,
                    ]}
                    onPress={() =>
                      changeType(
                        'expense',
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.typeText,

                        editType ===
                          'expense' &&
                          styles.typeTextActive,
                      ]}
                    >
                      支出
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.typeBtn,

                      editType ===
                        'income' &&
                        styles.typeBtnActive,
                    ]}
                    onPress={() =>
                      changeType(
                        'income',
                      )
                    }
                  >
                    <Text
                      style={[
                        styles.typeText,

                        editType ===
                          'income' &&
                          styles.typeTextActive,
                      ]}
                    >
                      收入
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Amount */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  金额
                </Text>

                <View
                  style={
                    styles.inputRow
                  }
                >
                  <Text
                    style={
                      styles.currencySymbol
                    }
                  >
                    RM
                  </Text>

                  <TextInput
                    style={
                      styles.amountInput
                    }
                    value={
                      editAmount
                    }
                    onChangeText={
                      setEditAmount
                    }
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={
                      colors.textTertiary
                    }
                  />
                </View>

                {/* Date */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  日期
                </Text>

                <TextInput
                  style={
                    styles.input
                  }
                  value={
                    editDate
                  }
                  onChangeText={
                    setEditDate
                  }
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={
                    colors.textTertiary
                  }
                />

                {/* Category */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  分类
                </Text>

                {visibleCategories.length >
                0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={
                      false
                    }
                    contentContainerStyle={
                      styles.categoryRow
                    }
                  >
                    {visibleCategories.map(
                      (category: any) => (
                        <TouchableOpacity
                          key={
                            category.id
                          }
                          style={[
                            styles.categoryChip,

                            editCategoryId ===
                              category.id &&
                              styles.categoryChipActive,
                          ]}
                          onPress={() =>
                            setEditCategoryId(
                              category.id,
                            )
                          }
                        >
                          <Text
                            style={[
                              styles.categoryChipText,

                              editCategoryId ===
                                category.id &&
                                styles.categoryChipTextActive,
                            ]}
                          >
                            {
                              category.name
                            }
                          </Text>
                        </TouchableOpacity>
                      ),
                    )}
                  </ScrollView>
                ) : (
                  <Text
                    style={
                      styles.noCategoryText
                    }
                  >
                    没有可用的
                    {editType ===
                    'expense'
                      ? '支出'
                      : '收入'}
                    分类
                  </Text>
                )}

                {/* Note */}

                <Text
                  style={
                    styles.fieldLabel
                  }
                >
                  内容
                </Text>

                <TextInput
                  style={[
                    styles.input,
                    styles.noteInput,
                  ]}
                  value={
                    editNote
                  }
                  onChangeText={
                    setEditNote
                  }
                  placeholder="备注"
                  placeholderTextColor={
                    colors.textTertiary
                  }
                  multiline
                />

                {/* Asset */}

                <View
                  style={
                    styles.assetInfo
                  }
                >
                  <Ionicons
                    name="wallet-outline"
                    size={15}
                    color={
                      colors.textTertiary
                    }
                  />

                  <Text
                    style={
                      styles.assetInfoText
                    }
                  >
                    入账资产：
                    {defaultAsset?.name ??
                      '未设置默认资产'}
                  </Text>
                </View>

                {/* Buttons */}

                <View
                  style={
                    styles.modalActions
                  }
                >
                  <TouchableOpacity
                    style={
                      styles.cancelButton
                    }
                    onPress={
                      cancelResult
                    }
                    activeOpacity={0.8}
                  >
                    <Text
                      style={
                        styles.cancelButtonText
                      }
                    >
                      取消
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={
                      styles.confirmButton
                    }
                    onPress={
                      saveVoiceTransaction
                    }
                    activeOpacity={0.8}
                  >
                    <Text
                      style={
                        styles.confirmButtonText
                      }
                    >
                      确认记账
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// =============================================================
// Helpers
// =============================================================

function todayStr() {
  const d = new Date();

  return `${d.getFullYear()}-${String(
    d.getMonth() + 1,
  ).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// =============================================================
// Styles
// =============================================================

function makeStyles(
  colors: ThemeColors,
) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor:
        colors.bg,
    },

    content: {
      padding: 20,
      paddingBottom: 40,
    },

    pageTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 4,
    },

    pageSub: {
      fontSize: 13,
      color: colors.textTertiary,
      marginBottom: 20,
    },

    // ---------------------------------------------------------
    // Scanner Card
    // ---------------------------------------------------------

    primaryCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        colors.textPrimary,
      borderRadius: 16,
      padding: 16,
      marginBottom: 26,
    },

    primaryCardIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor:
        'rgba(128,128,128,0.24)',
      alignItems: 'center',
      justifyContent: 'center',
    },

    primaryCardText: {
      flex: 1,
      marginLeft: 14,
    },

    primaryCardTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.bg,
    },

    primaryCardDesc: {
      fontSize: 12,
      color: colors.bg,
      opacity: 0.7,
      marginTop: 4,
    },

    chevron: {
      fontSize: 24,
      color: colors.bg,
      opacity: 0.6,
      marginLeft: 8,
    },

    // ---------------------------------------------------------
    // Section
    // ---------------------------------------------------------

    sectionTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textPrimary,
      marginBottom: 12,
      marginTop: 2,
    },

    // ---------------------------------------------------------
    // Voice Card
    // ---------------------------------------------------------

    voiceCard: {
      backgroundColor:
        colors.card,
      borderRadius: 18,
      padding: 22,
      alignItems: 'center',
      marginBottom: 28,
    },

    voiceIconWrap: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor:
        colors.textPrimary,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 14,
    },

    voiceTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },

    voiceDesc: {
      fontSize: 12,
      color: colors.textTertiary,
      marginTop: 6,
      textAlign: 'center',
    },

    recordButton: {
      marginTop: 18,
      minWidth: 150,
      borderRadius: 14,
      paddingVertical: 13,
      paddingHorizontal: 20,
      backgroundColor:
        colors.textPrimary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },

    recordButtonActive: {
      opacity: 0.85,
    },

    recordButtonDisabled: {
      opacity: 0.55,
    },

    recordButtonText: {
      color: colors.bg,
      fontSize: 14,
      fontWeight: '700',
    },

    examples: {
      width: '100%',
      marginTop: 20,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor:
        colors.dividerHair,
    },

    exampleTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: 7,
    },

    exampleText: {
      fontSize: 12,
      color: colors.textTertiary,
      lineHeight: 20,
    },

    // ---------------------------------------------------------
    // Other AI
    // ---------------------------------------------------------

    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },

    comingCard: {
      width: '48%',
      backgroundColor:
        colors.card,
      borderRadius: 14,
      padding: 14,
      marginBottom: 12,
    },

    comingTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textPrimary,
      marginTop: 8,
    },

    comingDesc: {
      fontSize: 11,
      color: colors.textTertiary,
      marginTop: 4,
      lineHeight: 16,
    },

    // ---------------------------------------------------------
    // Modal
    // ---------------------------------------------------------

    modalOverlay: {
      flex: 1,
      backgroundColor:
        colors.overlay,
      justifyContent: 'flex-end',
    },

    modalCard: {
      backgroundColor:
        colors.card,
      borderTopLeftRadius: 22,
      borderTopRightRadius: 22,
      padding: 20,
      maxHeight: '92%',
    },

    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent:
        'space-between',
      marginBottom: 14,
    },

    modalTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textPrimary,
    },

    // ---------------------------------------------------------
    // Transcript
    // ---------------------------------------------------------

    transcriptLabel: {
      fontSize: 11,
      color: colors.textTertiary,
      marginBottom: 5,
    },

    transcript: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textPrimary,
      backgroundColor:
        colors.bg,
      borderRadius: 10,
      padding: 10,
      marginBottom: 12,
    },

    // ---------------------------------------------------------
    // Type
    // ---------------------------------------------------------

    typeSwitch: {
      flexDirection: 'row',
      backgroundColor:
        colors.bg,
      borderRadius: 12,
      padding: 4,
      marginBottom: 8,
    },

    typeBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 9,
      alignItems: 'center',
    },

    typeBtnActive: {
      backgroundColor:
        colors.textPrimary,
    },

    typeText: {
      fontSize: 13,
      color: colors.textSecondary,
      fontWeight: '600',
    },

    typeTextActive: {
      color: colors.bg,
    },

    // ---------------------------------------------------------
    // Fields
    // ---------------------------------------------------------

    fieldLabel: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 8,
      marginBottom: 6,
    },

    input: {
      backgroundColor:
        colors.bg,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: 14,
    },

    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor:
        colors.bg,
      borderRadius: 10,
      paddingHorizontal: 12,
    },

    currencySymbol: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textSecondary,
      marginRight: 4,
    },

    amountInput: {
      flex: 1,
      paddingVertical: 11,
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '700',
    },

    noteInput: {
      minHeight: 48,
      textAlignVertical: 'top',
    },

    // ---------------------------------------------------------
    // Categories
    // ---------------------------------------------------------

    categoryRow: {
      gap: 8,
      paddingBottom: 4,
    },

    categoryChip: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor:
        colors.dividerHair,
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor:
        colors.bg,
    },

    categoryChipActive: {
      backgroundColor:
        colors.textPrimary,
      borderColor:
        colors.textPrimary,
    },

    categoryChipText: {
      fontSize: 12,
      color: colors.textSecondary,
    },

    categoryChipTextActive: {
      color: colors.bg,
      fontWeight: '700',
    },

    noCategoryText: {
      fontSize: 12,
      color: colors.textTertiary,
      paddingVertical: 8,
    },

    // ---------------------------------------------------------
    // Asset
    // ---------------------------------------------------------

    assetInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 12,
    },

    assetInfoText: {
      fontSize: 11,
      color: colors.textTertiary,
      marginLeft: 6,
    },

    // ---------------------------------------------------------
    // Buttons
    // ---------------------------------------------------------

    modalActions: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 18,
    },

    cancelButton: {
      flex: 1,
      borderRadius: 13,
      borderWidth: 1,
      borderColor:
        colors.dividerHair,
      paddingVertical: 14,
      alignItems: 'center',
    },

    cancelButtonText: {
      color: colors.textPrimary,
      fontSize: 14,
      fontWeight: '700',
    },

    confirmButton: {
      flex: 1,
      borderRadius: 13,
      backgroundColor:
        colors.textPrimary,
      paddingVertical: 14,
      alignItems: 'center',
    },

    confirmButtonText: {
      color: colors.bg,
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
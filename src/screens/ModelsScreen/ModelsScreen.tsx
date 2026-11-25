import React, {useState, useContext, useEffect} from 'react';
import {
  FlatList,
  RefreshControl,
  Platform,
  Alert,
  View,
  TextInput,
  TouchableOpacity,
  Text,
  ScrollView,
} from 'react-native';

import {reaction, computed, runInAction} from 'mobx';
import {v4 as uuidv4} from 'uuid';
import 'react-native-get-random-values';
import {observer} from 'mobx-react-lite';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {pick, types} from '@react-native-documents/picker';
import {Portal, Snackbar} from 'react-native-paper';

import {useTheme} from '../../hooks';

import {FABGroup} from './FABGroup';
import {ModelCard} from './ModelCard';
import {createStyles} from './styles';
import {HFModelSearch} from './HFModelSearch';
import {ModelAccordion} from './ModelAccordion';
import {
  DownloadErrorDialog,
  ErrorSnackbar,
  ModelSettingsSheet,
  ModelErrorReportSheet,
  RemoteModelSheet,
  ServerDetailsSheet,
} from '../../components';

import {uiStore, modelStore, hfStore, UIStore, serverStore, asrStore, ttsStore} from '../../store';

import {L10nContext, isProjectionModel, formatBytes, hfAsModel} from '../../utils';
import {Model, ModelOrigin, ModelType} from '../../utils/types';
import {ErrorState} from '../../utils/errors';
import type {AsrTier} from '../../services/asr';
import type {NeuralEngineId} from '../../store/TtsStore';

export type ModelCategory = 'hammasi' | 'llm' | 'omni' | 'stt' | 'tts' | 'projector';

interface ModelsScreenProps {
  route?: {
    params?: {
      initialCategory?: ModelCategory;
    };
  };
}

export const ModelsScreen: React.FC<ModelsScreenProps> = observer(({route}) => {
  const l10n = useContext(L10nContext);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [hfSearchVisible, setHFSearchVisible] = useState(false);
  const [isCopyingModel, setIsCopyingModel] = useState(false);
  const [isSearchingProjector, setIsSearchingProjector] = useState(false);
  const [selectedModel, setSelectedModel] = useState<Model | undefined>();
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ModelCategory>(
    (route?.params?.initialCategory as ModelCategory) || 'hammasi',
  );

  useEffect(() => {
    if (route?.params?.initialCategory) {
      setSelectedCategory(route?.params?.initialCategory);
    }
  }, [route?.params?.initialCategory]);

  // Centralized error state tracking - derive directly from MobX stores
  const [activeError, setActiveError] = useState<ErrorState | null>(null);
  const [isShowingErrorDialog, setIsShowingErrorDialog] = useState(false);

  // Model error report sheet state
  const [isErrorReportVisible, setIsErrorReportVisible] = useState(false);
  const [errorToReport, setErrorToReport] = useState<ErrorState | null>(null);

  // Remote model / server details sheets
  const [remoteModelSheetVisible, setRemoteModelSheetVisible] = useState(false);
  const [serverDetailsSheetVisible, setServerDetailsSheetVisible] =
    useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  const theme = useTheme();
  const styles = createStyles(theme);

  const filters = uiStore.pageStates.modelsScreen.filters;
  const expandedGroups = uiStore.pageStates.modelsScreen.expandedGroups;

  // Set up MobX reactions to track store changes
  useEffect(() => {
    // Create a reaction for error handling
    const errorDisposer = reaction(
      // Track these observable values
      () => ({
        hfError: hfStore.error,
        downloadError: modelStore.downloadError,
        modelLoadError: modelStore.modelLoadError,
      }),
      // React to changes
      data => {
        // First check if there's a download error that should show a dialog
        const hasDialogError =
          data.downloadError && data.downloadError.metadata?.modelId;

        setIsShowingErrorDialog(!!hasDialogError);

        // Then determine which error to show in the snackbar
        if (hasDialogError) {
          // If showing a dialog, don't show snackbar
          setActiveError(null);
        } else if (data.modelLoadError) {
          // Model load errors should show in snackbar
          setActiveError(data.modelLoadError);
        } else if (data.hfError) {
          // If we have an HF error, show it
          setActiveError(data.hfError);
        } else if (data.downloadError) {
          // For download errors without model ID, show in snackbar
          setActiveError(data.downloadError);
        } else {
          // No errors to show
          setActiveError(null);
        }
      },
    );

    // Clean up the reaction when component unmounts
    return () => {
      errorDisposer();
    };
  }, []); // Only run setup once

  const onRefresh = async () => {
    setRefreshing(true);
    await modelStore.refreshDownloadStatuses();
    setRefreshing(false);
  };

  const handleOpenSettings = (model: Model) => {
    setSelectedModel(model);
    setSettingsVisible(true);
  };

  const handleCloseSettings = () => {
    setSettingsVisible(false);
    setSelectedModel(undefined);
  };

  const handleAddRemoteModel = () => {
    setRemoteModelSheetVisible(true);
  };

  const handleManageServers = () => {
    const servers = serverStore.servers;
    if (servers.length === 1) {
      handleOpenServerDetails(servers[0].id);
    } else if (servers.length > 1) {
      Alert.alert(l10n.settings.manageServers, undefined, [
        ...servers.map(server => ({
          text: server.name,
          onPress: () => handleOpenServerDetails(server.id),
        })),
        {text: l10n.common.cancel, style: 'cancel' as const},
      ]);
    }
  };

  const handleOpenServerDetails = (serverId: string) => {
    setSelectedServerId(serverId);
    setServerDetailsSheetVisible(true);
  };

  const handleDismissError = () => {
    // Clear errors from all stores
    hfStore.clearError();
    modelStore.clearDownloadError();
    modelStore.clearModelLoadError();
  };

  const handleRetryAction = () => {
    if (activeError?.context === 'search') {
      hfStore.fetchModels();
    } else if (activeError?.context === 'download') {
      modelStore.retryDownload();
    } else if (activeError?.context === 'modelInit') {
      // Retry model initialization
      const modelId = activeError.metadata?.modelId;
      if (modelId) {
        const model = modelStore.models.find(m => m.id === modelId);
        if (model) {
          modelStore.selectModel(model);
        }
      }
    }
    handleDismissError();
  };

  const handleReportModelError = () => {
    if (activeError?.context === 'modelInit') {
      setErrorToReport(activeError);
      setIsErrorReportVisible(true);
      handleDismissError();
    }
  };

  const handleCloseErrorReport = () => {
    setIsErrorReportVisible(false);
    setErrorToReport(null);
  };

  /**
   * A model carried onto the phone usually arrives alone, and without its
   * projector it answers from text only. Offer to fetch the missing half by
   * name; "Add projector (mmproj)" on the card stays the manual fallback for
   * the file that lives on a repository the search cannot reach.
   */
  const offerProjectorForImportedModel = async (fullPath: string) => {
    const model = modelStore.models.find(m => m.fullPath === fullPath);
    if (
      !model ||
      model.modelType === ModelType.PROJECTION ||
      isProjectionModel(model.filename ?? '') ||
      model.supportsMultimodal
    ) {
      return;
    }

    const search = await new Promise<boolean>(resolve => {
      Alert.alert(
        l10n.models.autoProjector.title,
        l10n.models.autoProjector.message.replace('{{model}}', model.name),
        [
          {
            text: l10n.common.cancel,
            style: 'cancel',
            onPress: () => resolve(false),
          },
          {
            text: l10n.models.autoProjector.search,
            onPress: () => resolve(true),
          },
        ],
      );
    });
    if (!search) {
      return;
    }

    setIsSearchingProjector(true);
    let projector: Model | undefined;
    try {
      projector = await modelStore.autoFetchProjectionModel(model.id);
    } catch (error) {
      console.warn('[ModelsScreen] Projector search threw:', error);
    } finally {
      setIsSearchingProjector(false);
    }

    Alert.alert(
      projector
        ? l10n.models.autoProjector.foundTitle
        : l10n.models.autoProjector.notFoundTitle,
      projector
        ? l10n.models.autoProjector.foundMessage
            .replace('{{projector}}', projector.filename ?? projector.name)
            .replace('{{repo}}', projector.hfModel?.id ?? projector.repo ?? '')
        : l10n.models.autoProjector.notFoundMessage.replace(
            '{{model}}',
            model.name,
          ),
    );
  };

  const handleAddLocalModel = async () => {
    if (isCopyingModel) {
      return;
    }

    pick({
      type: Platform.OS === 'ios' ? 'public.data' : types.allFiles,
    })
      .then(async res => {
        let [file] = res;
        if (file) {
          // Assign a default name if file.name is null or undefined
          // Not sure if this can ever happen, though.
          let fileName =
            file.name || file.uri.split('/').pop() || `file_${uuidv4()}`;

          const permanentDir = `${RNFS.DocumentDirectoryPath}/models/local`;
          let permanentPath = `${permanentDir}/${fileName}`;
          if (!(await RNFS.exists(permanentDir))) {
            await RNFS.mkdir(permanentDir);
          }

          if (await RNFS.exists(permanentPath)) {
            const choice = await new Promise<'replace' | 'keep' | 'cancel'>(
              resolve => {
                Alert.alert(
                  l10n.models.fileManagement.fileAlreadyExists,
                  l10n.models.fileManagement.fileAlreadyExistsMessage,
                  [
                    {
                      text: l10n.models.fileManagement.replace,
                      onPress: () => resolve('replace'),
                    },
                    {
                      text: l10n.models.fileManagement.keepBoth,
                      onPress: () => resolve('keep'),
                    },
                    {
                      text: l10n.common.cancel,
                      onPress: () => resolve('cancel'),
                      style: 'cancel',
                    },
                  ],
                );
              },
            );

            switch (choice) {
              case 'replace':
                await RNFS.unlink(permanentPath);
                modelStore.removeModelByFullPath(permanentPath);
                break;
              case 'keep':
                let counter = 1;
                const nameParts = fileName.split('.');
                const ext = nameParts.length > 1 ? nameParts.pop() : '';
                const name = nameParts.join('.');
                do {
                  permanentPath = `${permanentDir}/${name}_${counter}.${ext}`;
                  counter++;
                } while (await RNFS.exists(permanentPath));
                break;
              case 'cancel':
                console.log('File copy cancelled by user');
                return;
            }
          }

          try {
            setIsCopyingModel(true);
            await RNFS.copyFile(file.uri, permanentPath);
            await modelStore.addLocalModel(permanentPath);
          } catch (e) {
            Alert.alert(
              l10n.models.fileManagement.copyFailed,
              e instanceof Error ? e.message : String(e),
            );
            return;
          } finally {
            setIsCopyingModel(false);
          }

          // An imported model is only as multimodal as the file sitting beside
          // it — and that file is the one thing a copy from a computer loses.
          if (permanentPath.toLowerCase().endsWith('.gguf')) {
            await offerProjectorForImportedModel(permanentPath);
          }
        }
      })
      .catch(e => console.log('No file picked, error: ', e.message));
  };

  const activeModelId = modelStore.activeModel?.id;
  const models = modelStore.displayModels;

  const isOmniModel = (name: string, filename?: string) =>
    /omni/i.test(name) ||
    /lfm3/i.test(name) ||
    (filename ? /omni/i.test(filename) || /lfm3/i.test(filename) : false);

  const KNOWN_PROJECTORS = [
    {
      id: 'LiquidAI/LFM3-Omni-2B-GGUF/mmproj-LFM3-Omni-2B-BF16.gguf',
      repo: 'LiquidAI/LFM3-Omni-2B-GGUF',
      filename: 'mmproj-LFM3-Omni-2B-BF16.gguf',
      name: 'LFM3-Omni Proyektori (BF16)',
      size: 853_000_000,
      description: 'LFM3-Omni audio va ko\'rish proyektori (Ovozli suhbat uchun talab qilinadi)',
      pairsWith: 'LFM3-Omni-2B',
    },
    {
      id: 'LiquidAI/LFM3-Omni-2B-GGUF/mmproj-LFM3-Omni-2B-Q8_0.gguf',
      repo: 'LiquidAI/LFM3-Omni-2B-GGUF',
      filename: 'mmproj-LFM3-Omni-2B-Q8_0.gguf',
      name: 'LFM3-Omni Proyektori (Q8_0)',
      size: 564_000_000,
      description: 'LFM3-Omni uchun siqilgan yuqori tezlikdagi audio proyektori',
      pairsWith: 'LFM3-Omni-2B',
    },
    {
      id: 'LiquidAI/LFM2-VL-1.6B-GGUF/mmproj-LFM2-VL-1.6B-Q8_0.gguf',
      repo: 'LiquidAI/LFM2-VL-1.6B-GGUF',
      filename: 'mmproj-LFM2-VL-1.6B-Q8_0.gguf',
      name: 'LFM2-VL Proyektori (Q8_0)',
      size: 564_115_648,
      description: 'LFM2-VL modeli uchun rasmlarni tahlil qilish proyektori',
      pairsWith: 'LFM2-VL-1.6B',
    },
    {
      id: 'unsloth/gemma-4-E2B-it-GGUF/mmproj-F16.gguf',
      repo: 'unsloth/gemma-4-E2B-it-GGUF',
      filename: 'mmproj-F16.gguf',
      name: 'Gemma Multimodal Proyektor (F16)',
      size: 985_654_080,
      description: 'Gemma modeli uchun multimodal ko\'rish proyektori',
      pairsWith: 'Gemma Multimodal',
    },
  ];

  const ensureProjectorModel = (proj: (typeof KNOWN_PROJECTORS)[0]): Model => {
    let existing = modelStore.models.find(
      m => m.id === proj.id || m.filename === proj.filename,
    );
    if (existing) {
      return existing;
    }
    const hfModel = {
      id: proj.repo,
      author: proj.repo.split('/')[0],
      url: `https://huggingface.co/${proj.repo}`,
    } as any;
    const modelFile = {
      rfilename: proj.filename,
      url: `https://huggingface.co/${proj.repo}/resolve/main/${proj.filename}`,
      size: proj.size,
    };
    const created: Model = {
      ...hfAsModel(hfModel, modelFile),
      modelType: ModelType.PROJECTION,
      name: proj.name,
    };
    runInAction(() => {
      modelStore.models.push(created);
    });
    return created;
  };

  // useMemo uses shallow comparison for dependencies,
  // so we use computed instead for deep comparison
  // (model state changes not-downloaded -> downloaded)
  const filteredAndSortedModels = computed(() => {
    let result = models;
    if (selectedCategory === 'llm') {
      result = result.filter(m => !isOmniModel(m.name, m.filename));
    } else if (selectedCategory === 'omni') {
      result = result.filter(
        m => isOmniModel(m.name, m.filename) || m.supportsMultimodal,
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        m =>
          m.name.toLowerCase().includes(q) ||
          (m.filename && m.filename.toLowerCase().includes(q)) ||
          (m.author && m.author.toLowerCase().includes(q)),
      );
    }
    if (filters.includes('downloaded')) {
      result = result.filter(model => model.isDownloaded);
    }
    if (!filters.includes('grouped')) {
      result = result.sort((a, b) => {
        if (a.isDownloaded && !b.isDownloaded) {
          return -1;
        }
        if (!a.isDownloaded && b.isDownloaded) {
          return 1;
        }
        return 0;
      });
    }
    if (filters.includes('hf')) {
      result = result.filter(model => model.origin === ModelOrigin.HF);
    }
    return result;
  }).get();

  const getGroupDisplayName = (key: string) => {
    switch (key) {
      case UIStore.GROUP_KEYS.READY_TO_USE:
        return l10n.models.labels.availableToUse;
      case UIStore.GROUP_KEYS.AVAILABLE_TO_DOWNLOAD:
        return l10n.models.labels.availableToDownload;
      default:
        return key;
    }
  };

  const groupedModels = computed(() => {
    if (!filters.includes('grouped')) {
      return {
        [UIStore.GROUP_KEYS.READY_TO_USE]: filteredAndSortedModels.filter(
          model => model.isDownloaded,
        ),
        [UIStore.GROUP_KEYS.AVAILABLE_TO_DOWNLOAD]:
          filteredAndSortedModels.filter(model => !model.isDownloaded),
      };
    }

    return filteredAndSortedModels.reduce(
      (acc, item) => {
        const groupKey =
          item.origin === ModelOrigin.LOCAL || item.isLocal
            ? l10n.models.labels.localModel
            : item.type || l10n.models.labels.unknownGroup;

        if (!acc[groupKey]) {
          acc[groupKey] = [];
        }
        acc[groupKey].push(item);
        return acc;
      },
      {} as Record<string, Model[]>,
    );
  }).get();

  const toggleGroup = (type: string) => {
    const currentExpandedGroups =
      uiStore.pageStates.modelsScreen.expandedGroups;
    const updatedExpandedGroups = {
      ...currentExpandedGroups,
      [type]: !currentExpandedGroups[type],
    };
    uiStore.setValue('modelsScreen', 'expandedGroups', updatedExpandedGroups);
  };

  const renderGroupHeader = ({item: group}) => {
    const isExpanded = expandedGroups[group.type];
    const displayName = filters.includes('grouped')
      ? group.type
      : getGroupDisplayName(group.type);
    const description =
      !filters.includes('grouped') &&
      group.type === UIStore.GROUP_KEYS.AVAILABLE_TO_DOWNLOAD
        ? l10n.models.labels.useAddButtonForMore
        : undefined;
    return (
      <ModelAccordion
        group={{...group, type: displayName}}
        expanded={isExpanded}
        description={description}
        onPress={() => toggleGroup(group.type)}>
        <FlatList
          data={group.items}
          keyExtractor={subItem => subItem.id}
          renderItem={({item: subItem}) => (
            <ModelCard
              model={subItem}
              activeModelId={activeModelId}
              onOpenSettings={() => handleOpenSettings(subItem)}
              onOpenServerDetails={handleOpenServerDetails}
            />
          )}
        />
      </ModelAccordion>
    );
  };

  const renderSTTSection = () => {
    const tiers: {tier: AsrTier; name: string; size: string; badge: string; desc: string}[] = [
      {
        tier: 'base',
        name: 'Whisper Base',
        size: '~82 MB',
        badge: '⚡ Tavsiya etiladi (4GB+ RAM)',
        desc: 'Barcha telefonlarga mos, juda tez va aniq oflayn transkripsiya.',
      },
      {
        tier: 'small',
        name: 'Whisper Small',
        size: '~265 MB',
        badge: '🎯 Yuqori aniqlik (6GB+ RAM)',
        desc: 'Shovqinli muhitda ham so\'zlarni va atamalarni yuqori aniqlikda taniydi.',
      },
      {
        tier: 'large-turbo',
        name: 'Whisper Large Turbo',
        size: '~574 MB',
        badge: '🚀 Maksimal sifat (8GB+ RAM)',
        desc: 'Flagman qurilmalar uchun eng sifatli universal nutq modeli.',
      },
    ];

    const filteredTiers = tiers.filter(t =>
      searchQuery ? t.name.toLowerCase().includes(searchQuery.toLowerCase()) : true,
    );

    return (
      <View style={{paddingBottom: 24}}>
        <Text style={styles.sectionTitle}>STT (Whisper) Modellar</Text>
        <Text style={styles.sectionSub}>Ovozni matnga aylantirish uchun oflayn modellar</Text>
        {filteredTiers.map(item => {
          const state = asrStore.downloadStates[item.tier];
          const progress = asrStore.downloadProgress[item.tier];
          const isSelected = item.tier === asrStore.selectedTier;
          const isReady = state === 'ready';
          const isDownloading = state === 'downloading';

          return (
            <View key={item.tier} style={styles.categoryCard}>
              <View style={styles.categoryCardHeader}>
                <View style={styles.categoryCardTitleRow}>
                  <Text style={styles.categoryCardTitle}>{item.name}</Text>
                  <Text style={styles.categoryCardSub}>{item.desc}</Text>
                </View>
                <View style={[styles.categoryCardBadge, isReady && styles.categoryCardBadgeActive]}>
                  <Text style={[styles.categoryCardBadgeText, isReady && styles.categoryCardBadgeTextActive]}>
                    {isReady ? (isSelected ? '✓ Faol' : 'O\'rnatilgan') : isDownloading ? 'Yuklanmoqda' : item.size}
                  </Text>
                </View>
              </View>

              <View style={styles.categoryCardMeta}>
                <Text style={styles.categoryCardMetaText}>{item.badge}</Text>
                <Text style={styles.categoryCardMetaText}>Hajmi: {item.size}</Text>
              </View>

              {isDownloading && (
                <View style={styles.categoryCardProgressContainer}>
                  <View style={styles.categoryCardProgressBar}>
                    <View style={[styles.categoryCardProgressFill, {width: `${Math.round(progress * 100)}%`}]} />
                  </View>
                  <Text style={styles.categoryCardProgressText}>{Math.round(progress * 100)}%</Text>
                </View>
              )}

              <View style={styles.categoryCardActions}>
                {isReady ? (
                  <>
                    <TouchableOpacity
                      style={[styles.categoryCardBtn, isSelected ? styles.categoryCardBtnOutline : styles.categoryCardBtnPrimary]}
                      onPress={() => asrStore.selectTier(item.tier)}>
                      <Text style={[styles.categoryCardBtnText, !isSelected && styles.categoryCardBtnTextPrimary]}>
                        {isSelected ? '✓ Tanlangan (Faol)' : 'Faol qilish'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.categoryCardBtn, styles.categoryCardBtnDanger, {flex: 0.35}]}
                      onPress={() => asrStore.deleteModel(item.tier)}>
                      <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextDanger]}>O'chirish</Text>
                    </TouchableOpacity>
                  </>
                ) : isDownloading ? (
                  <View style={[styles.categoryCardBtn, styles.categoryCardBtnOutline]}>
                    <Text style={styles.categoryCardBtnText}>Yuklanmoqda...</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.categoryCardBtn, styles.categoryCardBtnPrimary]}
                    onPress={async () => {
                      asrStore.setUserASROverride(true);
                      await asrStore.downloadModel(item.tier);
                    }}>
                    <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextPrimary]}>
                      📥 Yuklab olish ({item.size})
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderTTSSection = () => {
    const voices: {
      id: NeuralEngineId | 'system';
      name: string;
      size: string;
      badge: string;
      desc: string;
      onDownload?: () => Promise<void>;
      onDelete?: () => Promise<void>;
    }[] = [
      {
        id: 'kokoro',
        name: 'Kokoro TTS',
        size: '~85 MB',
        badge: '⭐ Tavsiya etiladi',
        desc: 'Eng tabiiy, ohangdor va yoqimli neyron ovoz modeli.',
        onDownload: () => ttsStore.downloadKokoro(),
        onDelete: () => ttsStore.deleteKokoro(),
      },
      {
        id: 'supertonic',
        name: 'Supertonic TTS',
        size: '~65 MB',
        badge: '⚡ Tezkor ovoz',
        desc: 'Kam resurs talab qiluvchi, o\'ta tez ishlovchi ovoz modeli.',
        onDownload: () => ttsStore.downloadSupertonic(),
        onDelete: () => ttsStore.deleteSupertonic(),
      },
      {
        id: 'kitten',
        name: 'Kitten TTS',
        size: '~55 MB',
        badge: '🐱 Ixcham ovoz',
        desc: 'Minimal hajmdagi yengil neyron nutq generatori.',
        onDownload: () => ttsStore.downloadKitten(),
        onDelete: () => ttsStore.deleteKitten(),
      },
      {
        id: 'phonon',
        name: 'Phonon TTS',
        size: '~75 MB',
        badge: '🌐 Ko\'p tilli ovoz',
        desc: 'Turli tillarga moslashgan zamonaviy ovoz generatori.',
        onDownload: () => ttsStore.downloadPhonon(),
        onDelete: () => ttsStore.deletePhonon(),
      },
      {
        id: 'system',
        name: 'Tizim ovozi (Platform)',
        size: 'O\'rnatilgan',
        badge: '📱 Telefon ovozi',
        desc: 'Telefoningiz operatsion tizimidagi o\'rnatilgan standart ovoz.',
      },
    ];

    const filteredVoices = voices.filter(v =>
      searchQuery ? v.name.toLowerCase().includes(searchQuery.toLowerCase()) : true,
    );

    return (
      <View style={{paddingBottom: 24}}>
        <Text style={styles.sectionTitle}>TTS (Ovozlar) Modellar</Text>
        <Text style={styles.sectionSub}>Matnni tabiiy ovozda gapirish uchun modellar</Text>
        {filteredVoices.map(item => {
          const isSystem = item.id === 'system';
          let state = 'not_installed';
          let progress = 0;
          if (isSystem) {
            state = 'ready';
            progress = 1;
          } else if (item.id === 'kokoro') {
            state = ttsStore.kokoroDownloadState;
            progress = ttsStore.kokoroDownloadProgress;
          } else if (item.id === 'supertonic') {
            state = ttsStore.supertonicDownloadState;
            progress = ttsStore.supertonicDownloadProgress;
          } else if (item.id === 'kitten') {
            state = ttsStore.kittenDownloadState;
            progress = ttsStore.kittenDownloadProgress;
          } else if (item.id === 'phonon') {
            state = ttsStore.phononDownloadState;
            progress = ttsStore.phononDownloadProgress;
          }
          const isReady = isSystem || state === 'ready';
          const isDownloading = state === 'downloading';

          return (
            <View key={item.id} style={styles.categoryCard}>
              <View style={styles.categoryCardHeader}>
                <View style={styles.categoryCardTitleRow}>
                  <Text style={styles.categoryCardTitle}>{item.name}</Text>
                  <Text style={styles.categoryCardSub}>{item.desc}</Text>
                </View>
                <View style={[styles.categoryCardBadge, isReady && styles.categoryCardBadgeActive]}>
                  <Text style={[styles.categoryCardBadgeText, isReady && styles.categoryCardBadgeTextActive]}>
                    {isReady ? 'O\'rnatilgan' : isDownloading ? 'Yuklanmoqda' : item.size}
                  </Text>
                </View>
              </View>

              <View style={styles.categoryCardMeta}>
                <Text style={styles.categoryCardMetaText}>{item.badge}</Text>
                <Text style={styles.categoryCardMetaText}>Hajmi: {item.size}</Text>
              </View>

              {isDownloading && (
                <View style={styles.categoryCardProgressContainer}>
                  <View style={styles.categoryCardProgressBar}>
                    <View style={[styles.categoryCardProgressFill, {width: `${Math.round(progress * 100)}%`}]} />
                  </View>
                  <Text style={styles.categoryCardProgressText}>{Math.round(progress * 100)}%</Text>
                </View>
              )}

              <View style={styles.categoryCardActions}>
                {isReady ? (
                  <>
                    <TouchableOpacity
                      style={[styles.categoryCardBtn, styles.categoryCardBtnPrimary]}
                      onPress={() => {
                        ttsStore.setUserTTSOverride(true);
                        ttsStore.play(`test-preview-${item.id}`, 'Salom! Men sizning PocketPal ovozli yordamchingizman.');
                      }}>
                      <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextPrimary]}>
                        ▶ Ovozni eshitish
                      </Text>
                    </TouchableOpacity>
                    {!isSystem && item.onDelete && (
                      <TouchableOpacity
                        style={[styles.categoryCardBtn, styles.categoryCardBtnDanger, {flex: 0.35}]}
                        onPress={item.onDelete}>
                        <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextDanger]}>O'chirish</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : isDownloading ? (
                  <View style={[styles.categoryCardBtn, styles.categoryCardBtnOutline]}>
                    <Text style={styles.categoryCardBtnText}>Yuklanmoqda...</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.categoryCardBtn, styles.categoryCardBtnPrimary]}
                    onPress={async () => {
                      ttsStore.setUserTTSOverride(true);
                      if (item.onDownload) {
                        await item.onDownload();
                      }
                    }}>
                    <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextPrimary]}>
                      📥 Yuklab olish ({item.size})
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderProjectorSection = () => {
    const knownFilenames = new Set(KNOWN_PROJECTORS.map(p => p.filename));
    const storeProjectors = modelStore.models.filter(
      m =>
        (m.modelType === ModelType.PROJECTION ||
          isProjectionModel(m.filename || '') ||
          m.filename?.startsWith('mmproj-')) &&
        !knownFilenames.has(m.filename),
    );

    const allProjectors = [
      ...KNOWN_PROJECTORS.map(p => {
        const model = ensureProjectorModel(p);
        return {
          id: model.id,
          name: p.name,
          filename: p.filename,
          size: formatBytes(p.size),
          desc: p.description,
          pairsWith: p.pairsWith,
          model,
        };
      }),
      ...storeProjectors.map(m => ({
        id: m.id,
        name: m.name || m.filename,
        filename: m.filename,
        size: formatBytes(m.size || 0),
        desc: 'Multimodal ko\'rish va audio proyektori',
        pairsWith: 'Multimodal model',
        model: m,
      })),
    ];

    const filteredProjectors = allProjectors.filter(p =>
      searchQuery
        ? p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.pairsWith.toLowerCase().includes(searchQuery.toLowerCase())
        : true,
    );

    return (
      <View style={{paddingBottom: 24}}>
        <Text style={styles.sectionTitle}>Proyektorlar (mmproj)</Text>
        <Text style={styles.sectionSub}>Omni va ko'rish modellari uchun zarur proyektor fayllari</Text>
        {filteredProjectors.map(item => {
          const isDownloaded = item.model.isDownloaded;
          const isDownloading = modelStore.isDownloading(item.model.id);
          const progress = item.model.progress || 0;

          return (
            <View key={item.id} style={styles.categoryCard}>
              <View style={styles.categoryCardHeader}>
                <View style={styles.categoryCardTitleRow}>
                  <Text style={styles.categoryCardTitle}>{item.name}</Text>
                  <Text style={styles.categoryCardSub}>{item.desc}</Text>
                </View>
                <View style={[styles.categoryCardBadge, isDownloaded && styles.categoryCardBadgeActive]}>
                  <Text style={[styles.categoryCardBadgeText, isDownloaded && styles.categoryCardBadgeTextActive]}>
                    {isDownloaded ? 'Yuklab olingan' : isDownloading ? 'Yuklanmoqda' : item.size}
                  </Text>
                </View>
              </View>

              <View style={styles.categoryCardMeta}>
                <Text style={styles.categoryCardMetaText}>Fayl: {item.filename}</Text>
                <Text style={styles.categoryCardMetaText}>Mos: {item.pairsWith}</Text>
              </View>

              {isDownloading && (
                <View style={styles.categoryCardProgressContainer}>
                  <View style={styles.categoryCardProgressBar}>
                    <View style={[styles.categoryCardProgressFill, {width: `${progress}%`}]} />
                  </View>
                  <Text style={styles.categoryCardProgressText}>{Math.round(progress)}%</Text>
                </View>
              )}

              <View style={styles.categoryCardActions}>
                {isDownloaded ? (
                  <>
                    <View style={[styles.categoryCardBtn, styles.categoryCardBtnOutline]}>
                      <Text style={styles.categoryCardBtnText}>✓ Foydalanishga tayyor</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.categoryCardBtn, styles.categoryCardBtnDanger, {flex: 0.35}]}
                      onPress={() => modelStore.deleteModel(item.model)}>
                      <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextDanger]}>O'chirish</Text>
                    </TouchableOpacity>
                  </>
                ) : isDownloading ? (
                  <View style={[styles.categoryCardBtn, styles.categoryCardBtnOutline]}>
                    <Text style={styles.categoryCardBtnText}>Yuklanmoqda ({Math.round(progress)}%)...</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={[styles.categoryCardBtn, styles.categoryCardBtnPrimary]}
                    onPress={() => modelStore.checkSpaceAndDownload(item.model.id)}>
                    <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextPrimary]}>
                      📥 Yuklab olish ({item.size})
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderOmniSection = () => {
    const lfm3Proj = KNOWN_PROJECTORS[0];
    const projModel = ensureProjectorModel(lfm3Proj);

    const omniModels = modelStore.models.filter(
      m =>
        m.modelType !== ModelType.PROJECTION &&
        (m.name?.toLowerCase().includes('omni') ||
          m.filename?.toLowerCase().includes('omni') ||
          m.name?.toLowerCase().includes('lfm3')),
    );

    return (
      <View style={{paddingBottom: 24}}>
        <View style={styles.omniBanner}>
          <Text style={styles.omniBannerTitle}>⚡ Omni (To'g'ridan-to'g'ri nutq) Modellar</Text>
          <Text style={styles.omniBannerText}>
            Omni modellar matn generatorlaridan farqli ravishda, ovozli xabarlarni to'g'ridan-to'g'ri tushunadi va alohida STT/TTS siz ovozda javob qaytaradi.{'\n\n'}
            Muhim: Model ovozda to'g'ri ishlashi uchun uning proyektor fayli (mmproj-LFM3-Omni-2B-BF16.gguf) ham yuklangan bo'lishi SHART.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>1. Kerakli Proyektor (mmproj)</Text>
        <Text style={styles.sectionSub}>Ovozli suhbat va eshitish uchun talab etiladi</Text>

        <View style={styles.categoryCard}>
          <View style={styles.categoryCardHeader}>
            <View style={styles.categoryCardTitleRow}>
              <Text style={styles.categoryCardTitle}>{lfm3Proj.name}</Text>
              <Text style={styles.categoryCardSub}>{lfm3Proj.description}</Text>
            </View>
            <View style={[styles.categoryCardBadge, projModel.isDownloaded && styles.categoryCardBadgeActive]}>
              <Text style={[styles.categoryCardBadgeText, projModel.isDownloaded && styles.categoryCardBadgeTextActive]}>
                {projModel.isDownloaded ? 'O\'rnatilgan' : formatBytes(lfm3Proj.size)}
              </Text>
            </View>
          </View>

          <View style={styles.categoryCardMeta}>
            <Text style={styles.categoryCardMetaText}>Fayl: {lfm3Proj.filename}</Text>
            <Text style={styles.categoryCardMetaText}>Hajmi: {formatBytes(lfm3Proj.size)}</Text>
          </View>

          {modelStore.isDownloading(projModel.id) && (
            <View style={styles.categoryCardProgressContainer}>
              <View style={styles.categoryCardProgressBar}>
                <View style={[styles.categoryCardProgressFill, {width: `${projModel.progress || 0}%`}]} />
              </View>
              <Text style={styles.categoryCardProgressText}>{Math.round(projModel.progress || 0)}%</Text>
            </View>
          )}

          <View style={styles.categoryCardActions}>
            {projModel.isDownloaded ? (
              <View style={[styles.categoryCardBtn, styles.categoryCardBtnOutline]}>
                <Text style={styles.categoryCardBtnText}>✓ Proyektor tayyor</Text>
              </View>
            ) : modelStore.isDownloading(projModel.id) ? (
              <View style={[styles.categoryCardBtn, styles.categoryCardBtnOutline]}>
                <Text style={styles.categoryCardBtnText}>Yuklanmoqda ({Math.round(projModel.progress || 0)}%)...</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.categoryCardBtn, styles.categoryCardBtnPrimary]}
                onPress={() => modelStore.checkSpaceAndDownload(projModel.id)}>
                <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextPrimary]}>
                  📥 Proyektorni yuklab olish ({formatBytes(lfm3Proj.size)})
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.sectionTitle}>2. Omni Asosiy Modellar</Text>
        <Text style={styles.sectionSub}>GGUF modelini yuklab oling yoki mahalliy faylni tanlang</Text>

        {omniModels.length === 0 ? (
          <View style={styles.categoryCard}>
            <Text style={styles.categoryCardTitle}>LFM3-Omni-2B Modeli</Text>
            <Text style={styles.categoryCardSub}>
              Hugging Face qidiruvidan "LiquidAI/LFM3-Omni-2B-GGUF" deb qidirib modelni qo'shishingiz yoki pastdagi ".gguf fayl tanlash" tugmasi orqali telefoningizdagi faylni yuklashingiz mumkin.
            </Text>
            <View style={[styles.categoryCardActions, {marginTop: 12}]}>
              <TouchableOpacity
                style={[styles.categoryCardBtn, styles.categoryCardBtnPrimary]}
                onPress={() => setHFSearchVisible(true)}>
                <Text style={[styles.categoryCardBtnText, styles.categoryCardBtnTextPrimary]}>
                  🔍 Hugging Face dan qidirish
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          omniModels.map(m => (
            <ModelCard
              key={m.id}
              model={m}
              activeModelId={activeModelId}
              onOpenSettings={() => handleOpenSettings(m)}
              onOpenServerDetails={handleOpenServerDetails}
            />
          ))
        )}
      </View>
    );
  };

  const flatListModels = Object.keys(groupedModels)
    .map(type => ({
      type,
      items: groupedModels[type],
    }))
    .filter(group => group.items.length > 0);

  const CATEGORIES: {id: ModelCategory; label: string}[] = [
    {id: 'hammasi', label: 'Barchasi'},
    {id: 'llm', label: 'LLM (Matn)'},
    {id: 'omni', label: 'Omni (Ovozli)'},
    {id: 'stt', label: 'STT (Whisper)'},
    {id: 'tts', label: 'TTS (Ovozlar)'},
    {id: 'projector', label: 'Proyektorlar (mmproj)'},
  ];

  const ListHeader = () => (
    <View style={styles.headerSection}>
      <Text style={styles.screenTitle}>Modellar</Text>
      <Text style={styles.screenSubtitle}>Telefoningizda ishlaydigan ochiq modellar</Text>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.searchInput}
          placeholder="Model qidirish"
          placeholderTextColor="#6B9E8A"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>
      {/* Category chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsContainer}>
        {CATEGORIES.map(cat => {
          const isActive = selectedCategory === cat.id;
          return (
            <TouchableOpacity
              key={cat.id}
              style={[styles.chip, isActive && styles.chipActive]}
              onPress={() => setSelectedCategory(cat.id)}>
              <Text style={isActive ? styles.chipTextActive : styles.chipText}>{cat.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Quick shortcuts on Barchasi */}
      {selectedCategory === 'hammasi' && !searchQuery && (
        <View style={styles.quickCategoryGrid}>
          <TouchableOpacity
            style={styles.quickCategoryItem}
            onPress={() => setSelectedCategory('omni')}>
            <Text style={styles.quickCategoryItemTitle}>⚡ Omni</Text>
            <Text style={styles.quickCategoryItemSub}>To'g'ridan ovoz</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCategoryItem}
            onPress={() => setSelectedCategory('stt')}>
            <Text style={styles.quickCategoryItemTitle}>🎙️ STT</Text>
            <Text style={styles.quickCategoryItemSub}>Whisper</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCategoryItem}
            onPress={() => setSelectedCategory('tts')}>
            <Text style={styles.quickCategoryItemTitle}>🔊 TTS</Text>
            <Text style={styles.quickCategoryItemSub}>Ovozlar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCategoryItem}
            onPress={() => setSelectedCategory('projector')}>
            <Text style={styles.quickCategoryItemTitle}>🧩 mmproj</Text>
            <Text style={styles.quickCategoryItemSub}>Proyektorlar</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const ListFooter = () => (
    <View style={styles.footerRow}>
      <TouchableOpacity style={styles.footerBtn} onPress={handleAddLocalModel}>
        <Text style={styles.footerBtnText}>.gguf fayl tanlash</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.footerBtn} onPress={() => setHFSearchVisible(true)}>
        <Text style={styles.footerBtnText}>Hugging Face</Text>
      </TouchableOpacity>
    </View>
  );

  const isCustomCategory =
    selectedCategory === 'stt' ||
    selectedCategory === 'tts' ||
    selectedCategory === 'projector' ||
    selectedCategory === 'omni';

  const flatListData = isCustomCategory
    ? [{type: selectedCategory, items: []}]
    : flatListModels;

  return (
    <View style={styles.container} testID="models-screen">
      {/* Show Error Snackbar only if no dialog is visible */}
      {!isShowingErrorDialog && activeError && (
        <ErrorSnackbar
          error={activeError}
          onDismiss={handleDismissError}
          onRetry={handleRetryAction}
          onReport={handleReportModelError}
        />
      )}

      <FlatList
        testID="flat-list"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContainer}
        data={flatListData}
        keyExtractor={item => item.type}
        extraData={activeModelId}
        renderItem={info => {
          if (selectedCategory === 'stt') {
            return renderSTTSection();
          }
          if (selectedCategory === 'tts') {
            return renderTTSSection();
          }
          if (selectedCategory === 'projector') {
            return renderProjectorSection();
          }
          if (selectedCategory === 'omni') {
            return renderOmniSection();
          }
          return renderGroupHeader(info);
        }}
        ListHeaderComponent={<ListHeader />}
        ListFooterComponent={<ListFooter />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
          />
        }
      />

      {/* DownloadErrorDialog with Portal for better visibility */}
      <Portal>
        <DownloadErrorDialog
          visible={isShowingErrorDialog}
          onDismiss={() => {
            modelStore.clearDownloadError();
          }}
          error={modelStore.downloadError}
          model={
            modelStore.downloadError?.metadata?.modelId
              ? modelStore.models.find(
                  m => m.id === modelStore.downloadError?.metadata?.modelId,
                )
              : undefined
          }
          onTryAgain={modelStore.retryDownload}
        />
      </Portal>

      <HFModelSearch
        visible={hfSearchVisible}
        onDismiss={() => setHFSearchVisible(false)}
      />
      <Snackbar
        testID="copy-model-snackbar"
        visible={isCopyingModel}
        onDismiss={() => {}}
        duration={86400000}>
        {l10n.models.fileManagement.copyingModel}
      </Snackbar>
      <Snackbar
        testID="projector-search-snackbar"
        visible={isSearchingProjector}
        onDismiss={() => {}}
        duration={86400000}>
        {l10n.models.autoProjector.searching}
      </Snackbar>
      <FABGroup
        onAddHFModel={() => setHFSearchVisible(true)}
        onAddLocalModel={handleAddLocalModel}
        onAddRemoteModel={handleAddRemoteModel}
        onManageServers={handleManageServers}
        hasServers={serverStore.servers.length > 0}
      />
      <ModelSettingsSheet
        isVisible={settingsVisible}
        onClose={handleCloseSettings}
        model={selectedModel}
      />
      <ModelErrorReportSheet
        isVisible={isErrorReportVisible}
        onClose={handleCloseErrorReport}
        error={errorToReport}
      />
      <RemoteModelSheet
        isVisible={remoteModelSheetVisible}
        onDismiss={() => setRemoteModelSheetVisible(false)}
      />
      <ServerDetailsSheet
        isVisible={serverDetailsSheetVisible}
        onDismiss={() => {
          setServerDetailsSheetVisible(false);
          setSelectedServerId(null);
        }}
        serverId={selectedServerId}
      />
    </View>
  );
});

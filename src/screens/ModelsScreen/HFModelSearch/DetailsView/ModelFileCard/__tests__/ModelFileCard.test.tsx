import React from 'react';
import {Alert, StyleSheet} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';

import {
  render as baseRender,
  fireEvent,
  act,
} from '../../../../../../../jest/test-utils';
import {
  hfModel1,
  createModel,
  mockHFModel1,
  modelsList,
} from '../../../../../../../jest/fixtures/models';

import {ModelFileCard} from '../ModelFileCard';

import {downloadManager} from '../../../../../../services/downloads';
import {ModelType} from '../../../../../../utils/types';

import {modelStore} from '../../../../../../store';

const render = (ui: React.ReactElement, options: any = {}) =>
  baseRender(ui, {withBottomSheetProvider: true, ...options});

describe('ModelFileCard', () => {
  const mockModelFile = {
    rfilename: 'test-model.gguf',
    size: 1000 * 1000 * 500, // 1GB
    oid: 'test-oid',
    canFitInStorage: true,
  };
  let downloadedHFModel;

  beforeEach(() => {
    downloadedHFModel = createModel({
      ...hfModel1,
      isDownloaded: true,
    });
    modelStore.models = modelsList;
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert');

    (downloadManager.isDownloading as jest.Mock).mockReset();
  });

  it('renders correctly with initial props', () => {
    const {getByTestId, getByText} = render(
      <ModelFileCard modelFile={mockModelFile} hfModel={mockHFModel1} />,
    );

    // Check that the card and file name are rendered using testIDs
    expect(getByTestId('model-file-card-test-model.gguf')).toBeDefined();
    expect(getByTestId('model-file-name-test-model.gguf')).toBeDefined();
    expect(getByText('500 MB')).toBeDefined();
  });

  it('handles bookmark toggle when not bookmarked', async () => {
    const {getByTestId} = render(
      <ModelFileCard modelFile={mockModelFile} hfModel={mockHFModel1} />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('bookmark-button'));
    });

    expect(modelStore.addHFModel).toHaveBeenCalledWith(
      mockHFModel1,
      mockModelFile,
    );
  });

  it('shows alert when trying to remove downloaded model', async () => {
    modelStore.models = [downloadedHFModel];

    const {getByTestId} = render(
      <ModelFileCard
        modelFile={downloadedHFModel.hfModelFile!}
        hfModel={downloadedHFModel.hfModel!}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('bookmark-button'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Cannot Remove',
      'The model is downloaded. Please delete the file first.',
    );
  });

  it('handles download initiation', async () => {
    const {getByTestId} = render(
      <ModelFileCard
        modelFile={mockHFModel1.siblings[0]}
        hfModel={mockHFModel1}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('download-button'));
    });

    expect(modelStore.downloadHFModel).toHaveBeenCalledWith(
      mockHFModel1,
      mockHFModel1.siblings[0],
      {enableVision: true},
    );
  });

  it('handles download cancellation', async () => {
    modelStore.models = [hfModel1];

    (downloadManager.isDownloading as jest.Mock).mockImplementation(modelId => {
      return modelId === hfModel1.id;
    });
    const {getByTestId} = render(
      <ModelFileCard
        modelFile={hfModel1.hfModelFile!}
        hfModel={hfModel1.hfModel!}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('cancel-button'));
    });

    expect(modelStore.cancelDownload).toHaveBeenCalledWith(hfModel1.id);
  });

  describe('progress fill', () => {
    const fillWidth = (ui: ReturnType<typeof render>) =>
      StyleSheet.flatten(ui.UNSAFE_getByType(LinearGradient).props.style).width;
    const renderWithProgress = (downloading: boolean) => {
      modelStore.models = [{...hfModel1, isDownloaded: false, progress: 40}];
      (downloadManager.isDownloading as jest.Mock).mockReturnValue(downloading);
      return render(
        <ModelFileCard
          modelFile={hfModel1.hfModelFile!}
          hfModel={hfModel1.hfModel!}
        />,
      );
    };

    it('follows progress while downloading', () => {
      expect(fillWidth(renderWithProgress(true))).toBe('40%');
    });

    it('stays empty for progress left from a failed download', () => {
      expect(fillWidth(renderWithProgress(false))).toBe('0%');
    });
  });

  it('disables download button when storage is insufficient', () => {
    const insufficientStorageFile = {
      ...mockModelFile,
      canFitInStorage: false,
    };

    const {getByTestId} = render(
      <ModelFileCard
        modelFile={insufficientStorageFile}
        hfModel={mockHFModel1}
      />,
    );

    expect(
      getByTestId('download-button').props.accessibilityState.disabled,
    ).toBe(true);
  });

  it('shows delete confirmation for downloaded model', async () => {
    modelStore.models = [downloadedHFModel];

    const {getByTestId} = render(
      <ModelFileCard
        modelFile={downloadedHFModel.hfModelFile!}
        hfModel={downloadedHFModel.hfModel!}
      />,
    );

    await act(async () => {
      fireEvent.press(getByTestId('download-button'));
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete Model',
      'Are you sure you want to delete this downloaded model?',
      expect.any(Array),
    );
  });

  describe('one card for the two files of an Omni model', () => {
    const llmFile = {
      rfilename: 'lfm3-omni-2b-Q4_K_M.gguf',
      size: 1_600_000_000,
      oid: 'llm-oid',
      canFitInStorage: true,
    };
    const projFile = {
      rfilename: 'mmproj-lfm3-omni-2b-Q8_0.gguf',
      size: 400_000_000,
      oid: 'proj-oid',
      canFitInStorage: true,
    };
    const repo = {...mockHFModel1, siblings: [llmFile, projFile]};
    const llmId = `${repo.id}/${llmFile.rfilename}`;
    const projId = `${repo.id}/${projFile.rfilename}`;

    const llmRow = createModel({
      id: llmId,
      filename: llmFile.rfilename,
      size: llmFile.size,
      hfModelFile: llmFile,
      hfModel: repo,
      supportsMultimodal: true,
      defaultProjectionModel: projId,
      isDownloaded: true,
      progress: 100,
    });
    const projectorRow = (state: any = {}) =>
      createModel({
        id: projId,
        filename: projFile.rfilename,
        size: projFile.size,
        hfModelFile: projFile,
        hfModel: repo,
        modelType: ModelType.PROJECTION,
        isDownloaded: false,
        progress: 0,
        ...state,
      });

    const renderPair = (state: any = {}) => {
      modelStore.models = [llmRow, projectorRow(state)];
      return render(<ModelFileCard modelFile={llmFile} hfModel={repo} />);
    };

    it('fills one bar for both files', () => {
      // The weights are on the device and the projector is halfway: nine tenths
      // of the pair, not a bar that stopped at 100% one file early.
      (downloadManager.isDownloading as jest.Mock).mockImplementation(
        (id: string) => id === projId,
      );
      const ui = renderPair({progress: 50});

      const fill = StyleSheet.flatten(
        ui.UNSAFE_getByType(LinearGradient).props.style,
      ).width;
      expect(fill).toBe('90%');
    });

    it('one more tap brings the file that is missing', async () => {
      const {getByTestId} = renderPair();

      await act(async () => {
        fireEvent.press(getByTestId('download-button'));
      });

      expect(modelStore.downloadProjectionModel).toHaveBeenCalledWith(projId);
      expect(modelStore.downloadHFModel).not.toHaveBeenCalled();
    });

    it('cancels both files of the pair', async () => {
      (downloadManager.isDownloading as jest.Mock).mockReturnValue(true);
      const {getByTestId} = renderPair();

      await act(async () => {
        fireEvent.press(getByTestId('cancel-button'));
      });

      expect(modelStore.cancelDownload).toHaveBeenCalledWith(llmId);
      expect(modelStore.cancelDownload).toHaveBeenCalledWith(projId);
    });

    it('asks about deleting once the whole pair is down', async () => {
      // Weights and projector are both on the device, so the one button on the
      // card has nothing left to fetch.
      (downloadManager.isDownloading as jest.Mock).mockReturnValue(false);
      const {getByTestId} = renderPair({isDownloaded: true, progress: 100});

      await act(async () => {
        fireEvent.press(getByTestId('download-button'));
      });

      expect(Alert.alert).toHaveBeenCalledWith(
        'Delete Model',
        'Are you sure you want to delete this downloaded model?',
        expect.any(Array),
      );
      expect(modelStore.downloadProjectionModel).not.toHaveBeenCalled();
      expect(modelStore.downloadHFModel).not.toHaveBeenCalled();
    });
  });
});

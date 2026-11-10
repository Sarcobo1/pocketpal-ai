import React from 'react';
import {render} from '@testing-library/react-native';

import {LimiGhost} from '../LimiGhost';

/**
 * The ghost is the app's only face. These tests pin the contract the rest of
 * the UI relies on: it renders at the requested size, it forwards the rig
 * state, and it always carries an accessibility label.
 *
 * The Skia port itself is replaced by a View under Jest (see
 * __mocks__/external/bot-avatars-native.js), so this asserts wiring, not
 * pixels.
 */
describe('LimiGhost', () => {
  it('renders a box at the requested size', () => {
    const {getByTestId} = render(<LimiGhost size={48} testID="ghost" />);
    const box = getByTestId('ghost');

    expect(box.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({width: 48, height: 48}),
      ]),
    );
  });

  it('defaults to a 36pt idle ghost', () => {
    const {getByTestId} = render(<LimiGhost testID="ghost" />);
    const box = getByTestId('ghost');

    expect(box.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({width: 36, height: 36}),
      ]),
    );
  });

  it('forwards the rig state to the avatar', () => {
    const {getByLabelText} = render(
      <LimiGhost state="sleeping" label="Limi uxlayapti" />,
    );

    expect(getByLabelText('Limi uxlayapti')).toBeTruthy();
  });

  it('is not interactive by default', () => {
    const {UNSAFE_getByType} = render(<LimiGhost />);
    const avatar = UNSAFE_getByType(require('bot-avatars-native').BotAvatar);

    expect(avatar.props.interactive).toBe(false);
  });
});

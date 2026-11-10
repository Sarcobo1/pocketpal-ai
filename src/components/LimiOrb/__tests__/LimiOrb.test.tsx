import React from 'react';
import {render} from '@testing-library/react-native';

import {LimiOrb} from '../LimiOrb';

/**
 * The orb is the app's only thinking indicator. These tests pin the contract
 * callers rely on: the rendered box is the requested dp size, the state is
 * forwarded to the port, and the preset is picked from the upstream pair
 * (64 avatar / 20 inline) rather than invented.
 *
 * The Skia port itself is replaced by a View under Jest (see
 * __mocks__/external/thinking-orbs-native.js), so this asserts wiring, not
 * pixels.
 */
describe('LimiOrb', () => {
  it('renders at the requested size', () => {
    const {getByTestId} = render(<LimiOrb size={28} testID="orb" />);
    const box = getByTestId('orb');

    expect(box.props.style).toEqual(
      expect.arrayContaining([
        expect.objectContaining({width: 28, height: 28}),
      ]),
    );
  });

  it('picks the inline preset below 32dp and the avatar preset at or above', () => {
    const {getByTestId, rerender} = render(<LimiOrb size={20} testID="orb" />);
    expect(getByTestId('orb').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({width: 20})]),
    );

    rerender(<LimiOrb size={64} testID="orb" />);
    expect(getByTestId('orb').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({width: 64})]),
    );
  });

  it('forwards the orb state', () => {
    const {UNSAFE_getByType} = render(<LimiOrb state="searching" />);
    const orb = UNSAFE_getByType(require('thinking-orbs-native').ThinkingOrb);

    expect(orb.props.state).toBe('searching');
  });

  it('defaults to the working state', () => {
    const {UNSAFE_getByType} = render(<LimiOrb />);
    const orb = UNSAFE_getByType(require('thinking-orbs-native').ThinkingOrb);

    expect(orb.props.state).toBe('working');
  });
});

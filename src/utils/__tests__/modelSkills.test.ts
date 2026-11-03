import {getModelSkills} from '../index';

const media = (audioOutput: boolean) => ({
  vision: true,
  audioInput: true,
  audioOutput,
});

describe('getModelSkills', () => {
  it('badges a model that carries a speech decoder', () => {
    const skills = getModelSkills({
      supportsMultimodal: true,
      mediaSupport: media(true),
    });

    expect(skills.map(skill => skill.key)).toEqual(['vision', 'voice']);
    expect(skills[1]).toEqual(
      expect.objectContaining({labelKey: 'voice', isSpecial: true}),
    );
  });

  it('stays quiet when the projector has no audio generator', () => {
    expect(
      getModelSkills({
        supportsMultimodal: true,
        mediaSupport: media(false),
      }).map(skill => skill.key),
    ).toEqual(['vision']);
    expect(getModelSkills({capabilities: ['code']}).map(s => s.key)).toEqual([
      'code',
    ]);
  });

  it('lists the voice once when a repository also declares it', () => {
    const skills = getModelSkills({
      supportsMultimodal: true,
      capabilities: ['voice', 'roleplay'],
      mediaSupport: media(true),
    });

    expect(skills.map(skill => skill.key)).toEqual([
      'vision',
      'voice',
      'roleplay',
    ]);
  });
});

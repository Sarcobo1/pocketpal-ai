import React from 'react';
import {View} from 'react-native';
import {observer} from 'mobx-react';
import {Text} from 'react-native-paper';

import {styles} from './styles';
import {chatSessionStore, modelStore} from '../../store';
import {LimiGhost} from '../LimiGhost';

export const ChatHeaderTitle: React.FC = observer(() => {
  const activeSessionId = chatSessionStore.activeSessionId;
  const activeSession = chatSessionStore.sessions.find(
    session => session.id === activeSessionId,
  );
  const activeModel = modelStore.activeModel;

  return (
    <View style={styles.container}>
      <LimiGhost size={26} state="default" label="Limi" />
      <View style={styles.titleWrapper}>
        <Text numberOfLines={1} variant="titleSmall" style={styles.title}>
          {activeSession?.title || 'Limi'}
        </Text>
        {activeModel?.name && (
          <Text numberOfLines={1} variant="bodySmall" style={styles.modelName}>
            {activeModel?.name}
          </Text>
        )}
      </View>
    </View>
  );
});

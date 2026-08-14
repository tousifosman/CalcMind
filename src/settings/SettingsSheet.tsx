// Settings sheet (§8.5, mode-strip cog). Opened from the keypad's Settings button;
// currently holds a single row — About — since nothing else has a home here yet. Styled
// after the reference screenshot the feature request shipped with: a full-screen dark
// list with an amber accent, rather than this app's usual light keypad chrome — a
// deliberate one-off, not a preview of P7.4's still-pending light/dark theme system.
import { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ChevronLeftIcon from 'react-native-heroicons/outline/ChevronLeftIcon';
import ChevronRightIcon from 'react-native-heroicons/outline/ChevronRightIcon';
import { version } from '../../package.json';
import { rolePalette } from '../ui/tokens';
import { useUiStore } from '../store/uiStore';

const accentColor = rolePalette.operator.fill;

type SettingsView = 'root' | 'about';

interface SettingsSheetProps {
  onDismiss: () => void;
}

export function SettingsSheet({ onDismiss }: SettingsSheetProps) {
  // Local, not uiStore: `SettingsOverlay` unmounts this component whenever the sheet
  // closes (settingsVisible false → null), which already resets `view` back to 'root'
  // on the next open — nothing outside this component needs to read it either.
  const [view, setView] = useState<SettingsView>('root');

  return (
    <Modal animationType="slide" onRequestClose={onDismiss} testID="settings-modal">
      <View style={styles.screen} testID="settings-screen">
        {view === 'root' ? (
          <RootPane onDone={onDismiss} onOpenAbout={() => setView('about')} />
        ) : (
          <AboutPane onBack={() => setView('root')} onDone={onDismiss} />
        )}
      </View>
    </Modal>
  );
}

function RootPane({ onDone, onOpenAbout }: { onDone: () => void; onOpenAbout: () => void }) {
  return (
    <>
      <View style={styles.header}>
        <View style={styles.headerSide} />
        <Text style={styles.headerTitle}>Settings</Text>
        <TouchableOpacity
          style={styles.headerSide}
          onPress={onDone}
          testID="settings-done"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneLabel}>Done</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={onOpenAbout}
          testID="settings-row-about"
          accessibilityRole="button"
        >
          <Text style={styles.rowLabel}>About</Text>
          <ChevronRightIcon size={18} color="#8E8E93" />
        </TouchableOpacity>
      </View>
    </>
  );
}

function AboutPane({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  return (
    <>
      <View style={styles.header}>
        <TouchableOpacity
          style={[styles.headerSide, styles.backButton]}
          onPress={onBack}
          testID="settings-about-back"
          accessibilityLabel="Back"
        >
          <ChevronLeftIcon size={20} color={accentColor} />
          <Text style={styles.backLabel}>Settings</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>About</Text>
        <TouchableOpacity
          style={styles.headerSide}
          onPress={onDone}
          testID="settings-about-done"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneLabel}>Done</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.aboutBody}>
        <Text style={styles.aboutName} testID="settings-about-name">
          CalcMind
        </Text>
        <Text style={styles.aboutVersion} testID="settings-about-version">
          Version {version}
        </Text>
        <Text style={styles.aboutTagline} testID="settings-about-tagline">
          A free-form canvas calculator: numbers and operators are nodes that snap together
          into formulas and recompute as you edit them.
        </Text>
      </View>
    </>
  );
}

/** Reads `settingsVisible` from uiStore. Mount once near the root. */
export function SettingsOverlay() {
  const settingsVisible = useUiStore((s) => s.settingsVisible);
  const closeSettings = useUiStore((s) => s.closeSettings);

  if (!settingsVisible) return null;

  return <SettingsSheet onDismiss={closeSettings} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  headerSide: {
    minWidth: 64,
    justifyContent: 'center',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backLabel: {
    color: accentColor,
    fontSize: 17,
    marginLeft: 2,
  },
  headerTitle: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  doneLabel: {
    color: accentColor,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'right',
  },
  section: {
    marginTop: 24,
    marginHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#1C1C1E',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowLabel: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  aboutBody: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 32,
  },
  aboutName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  aboutVersion: {
    color: '#8E8E93',
    fontSize: 15,
    marginTop: 4,
  },
  aboutTagline: {
    color: '#C7C7CC',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 20,
  },
});

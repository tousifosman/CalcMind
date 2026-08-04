// Dangling-reference recovery sheet (§11.2 / P6.4).
//
// Tapping a dangling cell opens this overlay: it explains what happened and offers
// the two useful actions — re-point at another value, or convert to a plain number
// freezing the last known value. Never a bare `?`.
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NodeId } from '../model/types';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { explainDanglingReference, isDanglingReference } from '../engine/reference';
import { unlinkFromParent } from '../store/commands';

interface DanglingRecoverySheetProps {
  referenceId: NodeId;
  onDismiss: () => void;
  onBeginRepoint: (referenceId: NodeId) => void;
}

export function DanglingRecoverySheet({
  referenceId,
  onDismiss,
  onBeginRepoint,
}: DanglingRecoverySheetProps) {
  const nodes = useDocumentStore((s) => s.document.nodes);
  const ref = nodes[referenceId];
  // Target may have been repaired or deleted while the sheet was open — bail cleanly.
  if (!ref || ref.kind !== 'reference' || !isDanglingReference(ref, nodes)) {
    return null;
  }

  const lastKnown = ref.lastKnownDisplay ?? '';

  return (
    <Modal
      transparent
      animationType="none"
      onRequestClose={onDismiss}
      testID="dangling-recovery-modal"
    >
      <Pressable style={styles.scrim} onPress={onDismiss} testID="dangling-recovery-scrim">
        <Pressable style={styles.sheet} testID="dangling-recovery-sheet">
          <Text style={styles.title} testID="dangling-recovery-explanation">
            {explainDanglingReference()}
          </Text>
          {lastKnown !== '' ? (
            <Text style={styles.lastKnown} testID="dangling-recovery-last-known">
              Last known value: {lastKnown}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.action}
              testID="dangling-recovery-repoint"
              accessibilityLabel="Re-point at another value"
              onPress={() => {
                onBeginRepoint(referenceId);
              }}
            >
              <Text style={styles.actionLabel}>Re-point at another value</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.action}
              testID="dangling-recovery-convert"
              accessibilityLabel="Convert to a plain number"
              onPress={() => {
                unlinkFromParent(referenceId);
                onDismiss();
              }}
            >
              <Text style={styles.actionLabel}>Convert to a plain number</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Reads `danglingRecoveryId` from uiStore. Mount once near the root. */
export function DanglingRecoveryOverlay() {
  const danglingRecoveryId = useUiStore((s) => s.danglingRecoveryId);
  const closeDanglingRecovery = useUiStore((s) => s.closeDanglingRecovery);
  const beginRepoint = useUiStore((s) => s.beginRepoint);

  if (!danglingRecoveryId) return null;

  return (
    <DanglingRecoverySheet
      referenceId={danglingRecoveryId}
      onDismiss={closeDanglingRecovery}
      onBeginRepoint={beginRepoint}
    />
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 16,
    paddingHorizontal: 18,
    minWidth: 280,
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 16,
    color: '#1A1A2E',
    marginBottom: 8,
  },
  lastKnown: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 12,
  },
  actions: {
    marginTop: 4,
  },
  action: {
    paddingVertical: 12,
  },
  actionLabel: {
    fontSize: 16,
    color: '#1A1A2E',
    fontWeight: '600',
  },
});

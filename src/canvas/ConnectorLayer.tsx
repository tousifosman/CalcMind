// SVG connector overlay (§11.1, §11.3, decision #13). Sits above NodeLayer inside
// the Canvas transform so pan/zoom move curves with the nodes. Geometry lives in
// `connectors.ts`; this file only paints.
//
// pointerEvents="none" throughout — connectors are visual, never a hit target.
// Selection / unlink stay on the cells and the long-press menu (§8.6).
//
// Mid-drag: reads `uiStore.dragSnap` the same way NodeLayer feeds
// `insertionFeedback`, so curve endpoints follow the finger before the store
// commits on release (including P3.7 MovingChain siblings via `movingChainId`).
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Marker, Path } from 'react-native-svg';
import {
  buildConnectorScene,
  CONNECTOR_STROKE_WIDTH,
  connectorMarkerId,
} from './connectors';
import { useDocumentStore } from '../store/documentStore';
import { useUiStore } from '../store/uiStore';
import { identityHueMapFor } from '../nodes/useIdentityHue';
import { getDeviceLocale } from '../ui/locale';
import { glyphColor } from '../ui/tokens';

const BADGE_RADIUS = 12;

export function ConnectorLayer() {
  // Whole-document subscription is intentional: any reference add/remove or
  // source move changes the scene. Per-node views stay scoped via their own
  // selectors (§11.4); this layer is the one place that must see the graph.
  const nodes = useDocumentStore((state) => state.document.nodes);
  const selectedNodeId = useUiStore((state) => state.selectedNodeId);
  const dragSnap = useUiStore((state) => state.dragSnap);
  const locale = getDeviceLocale();

  const scene = useMemo(() => {
    const hues = identityHueMapFor(nodes);
    const drag = dragSnap
      ? {
          nodeId: dragSnap.nodeId,
          position: dragSnap.position,
          movingChainId: dragSnap.movingChainId,
          movingSelection: dragSnap.movingSelection,
        }
      : null;
    return buildConnectorScene(nodes, hues, locale, selectedNodeId, drag);
  }, [nodes, locale, selectedNodeId, dragSnap]);

  if (scene.curves.length === 0 && scene.badges.length === 0) {
    return null;
  }

  const { bounds } = scene;

  return (
    <View pointerEvents="none" style={styles.layer} testID="connector-layer">
      {bounds && scene.curves.length > 0 ? (
        <Svg
          pointerEvents="none"
          testID="connector-svg"
          width={bounds.width}
          height={bounds.height}
          viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
          style={[
            styles.svg,
            {
              left: bounds.minX,
              top: bounds.minY,
              width: bounds.width,
              height: bounds.height,
            },
          ]}
        >
          <Defs>
            {scene.hues.map((hue) => (
              <Marker
                key={hue}
                id={connectorMarkerId(hue)}
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <Path d="M0 1 L9 5 L0 9 z" fill={hue} />
              </Marker>
            ))}
          </Defs>
          {scene.curves.map((curve) => (
            <Path
              key={curve.key}
              testID={`connector-curve-${curve.referenceNodeId}`}
              d={curve.d}
              stroke={curve.hue}
              strokeWidth={CONNECTOR_STROKE_WIDTH}
              fill="none"
              opacity={curve.opacity}
              markerEnd={`url(#${connectorMarkerId(curve.hue)})`}
            />
          ))}
        </Svg>
      ) : null}
      {scene.badges.map((badge) => (
        <View
          key={badge.sourceNodeId}
          testID={`connector-badge-${badge.sourceNodeId}`}
          // Decorative: the layer is pointerEvents="none", so keep this out of
          // the accessibility tree rather than announcing a non-actionable label.
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[
            styles.badge,
            {
              left: badge.position.x - BADGE_RADIUS,
              top: badge.position.y - BADGE_RADIUS,
              backgroundColor: badge.hue,
            },
          ]}
        >
          <Text style={styles.badgeText} importantForAccessibility="no">
            {badge.count}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Above idle nodes, below a dragged node (zIndex 1000) and the insertion
    // caret (1100), so mid-drag chrome stays readable over the curves.
    zIndex: 500,
  },
  svg: {
    position: 'absolute',
    overflow: 'visible',
  },
  badge: {
    position: 'absolute',
    width: BADGE_RADIUS * 2,
    height: BADGE_RADIUS * 2,
    borderRadius: BADGE_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: glyphColor,
    fontSize: 12,
    fontWeight: '800',
  },
});

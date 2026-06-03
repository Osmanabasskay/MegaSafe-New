import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, Text, View } from 'react-native';

const { width: W, height: H } = Dimensions.get('window');

const ORBIT_R = 110;
const DOT_SIZE = 20;
const CENTER_SIZE = 100;
const CONTAINER = ORBIT_R * 2 + DOT_SIZE;
const CX = CONTAINER / 2;

export default function SplashAnimation({ onDone }: { onDone: () => void }) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 5000,
        useNativeDriver: true,
      })
    ).start();

    const timer = setTimeout(onDone, 5000);
    return () => clearTimeout(timer);
  }, []);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Dot positions at their starting angles on the orbit circle
  // Green: top (-90°) => (0, -R)
  // Orange: left-ish (210°) => (-R*cos30, R*sin30) ≈ (-95, 55)
  // Light: right (15°) => (R*cos15, R*sin15) ≈ (106, 28)
  const dotLeft = (dx: number) => CX + dx - DOT_SIZE / 2;
  const dotTop  = (dy: number) => CX + dy - DOT_SIZE / 2;

  return (
    <Animated.View style={[styles.container, { opacity: fadeIn }]}>
      {/* Title */}
      <View style={styles.titleRow}>
        <Text style={styles.titleMi}>Mi </Text>
        <Text style={styles.titleOsusu}>Osusu</Text>
      </View>

      {/* Orbital visualization */}
      <View style={[styles.orbitWrap, { width: CONTAINER, height: CONTAINER }]}>
        {/* Orbit path ring */}
        <View
          style={[
            styles.orbitRing,
            {
              width: ORBIT_R * 2,
              height: ORBIT_R * 2,
              borderRadius: ORBIT_R,
              left: DOT_SIZE / 2,
              top: DOT_SIZE / 2,
            },
          ]}
        />

        {/* Rotating dots container */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ rotate: spin }] },
          ]}
        >
          {/* Green dot — top */}
          <View
            style={[
              styles.dot,
              styles.dotGreen,
              { left: dotLeft(0), top: dotTop(-ORBIT_R) },
            ]}
          />
          {/* Orange dot — lower left */}
          <View
            style={[
              styles.dot,
              styles.dotOrange,
              {
                left: dotLeft(-ORBIT_R * Math.cos(30 * (Math.PI / 180))),
                top:  dotTop(ORBIT_R * Math.sin(30 * (Math.PI / 180))),
              },
            ]}
          />
          {/* Light gray-green dot — right */}
          <View
            style={[
              styles.dot,
              styles.dotLight,
              {
                left: dotLeft(ORBIT_R * Math.cos(15 * (Math.PI / 180))),
                top:  dotTop(ORBIT_R * Math.sin(15 * (Math.PI / 180))),
              },
            ]}
          />
        </Animated.View>

        {/* Central navy circle */}
        <View
          style={[
            styles.centerCircle,
            {
              left: CX - CENTER_SIZE / 2,
              top:  CX - CENTER_SIZE / 2 + 18,
            },
          ]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FAF8F4',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: H * 0.1,
  },
  titleMi: {
    fontSize: 52,
    fontWeight: '800',
    color: '#1E2B5A',
    letterSpacing: 0,
  },
  titleOsusu: {
    fontSize: 52,
    fontWeight: '800',
    color: '#F97316',
    letterSpacing: 0,
  },
  orbitWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbitRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(249,115,22,0.45)',
    backgroundColor: 'transparent',
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  dotGreen:  { backgroundColor: '#22C55E' },
  dotOrange: { backgroundColor: '#F97316' },
  dotLight:  { backgroundColor: '#A8C4A2' },
  centerCircle: {
    position: 'absolute',
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_SIZE / 2,
    backgroundColor: '#1E2B5A',
    shadowColor: '#1E2B5A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
});

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

interface Slice {
  value: number;
  color: string;
}

export default function DonutChart({
  data,
  size = 160,
  strokeWidth = 24,
  rotation = 0,
}: {
  data: Slice[];
  size?: number;
  strokeWidth?: number;
  /** 整环的起始角度微调（度，负=逆时针），默认从12点方向开始 */
  rotation?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;

  let offsetAccumulated = 0;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G transform={`rotate(${-90 + rotation} ${size / 2} ${size / 2})`}>
          {data.map((slice, i) => {
            const fraction = slice.value / total;
            const dashLength = fraction * circumference;
            const dashArray = `${dashLength} ${circumference - dashLength}`;
            const dashOffset = -offsetAccumulated;
            offsetAccumulated += dashLength;
            return (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={slice.color}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                fill="transparent"
              />
            );
          })}
        </G>
      </Svg>
    </View>
  );
}

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

// 是否在 Expo Go 里跑（不是 development build / 正式安装包）。
// SDK 53 起，Expo Go(Android) 只要调用推送token相关功能就会直接抛出致命错误，
// 这个错误绕开了外面的 try/catch，所以必须在调用前就判断好，完全跳过，不能等出错再catch。
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// 前台收到通知时的展示方式
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * 请求权限并拿到 Expo Push Token。
 * 必须在真机上运行，模拟器拿不到有效token。
 * 在 Expo Go 里会直接跳过并返回 null，要用 development build 才会真正执行。
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (isExpoGo) {
    console.warn('当前是Expo Go环境，推送token功能不可用，需要development build才能测试');
    return null;
  }

  if (!Device.isDevice) {
    console.warn('推送通知必须在真机上测试');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('用户拒绝了推送通知权限');
    return null;
  }

  // projectId 来自 app.json / eas.json 里的 EAS 项目配置
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    console.warn('找不到 EAS projectId,请确认已经跑过 eas build:configure');
    return null;
  }

  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenData.data;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  return token;
}

/**
 * 把拿到的 token 发给后端保存起来,后端之后就能用这个 token 推消息给这个用户/设备。
 * 把 URL 换成你部署到 Hostinger 之后的实际地址。
 */
export async function sendTokenToBackend(token: string, userId: string) {
  try {
    const res = await fetch('https://your-hostinger-domain.com/api/register-push-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, token }),
    });
    if (!res.ok) {
      console.warn('推送token注册失败', await res.text());
    }
  } catch (err) {
    console.error('推送token注册请求出错', err);
  }
}

/**
 * 监听收到的通知(前台)和用户点击通知(不管前台/后台)。
 * 返回一个清理函数,记得在组件卸载时调用。
 */
export function addNotificationListeners(
  onReceive: (notification: Notifications.Notification) => void,
  onTap: (response: Notifications.NotificationResponse) => void
) {
  const receivedSub = Notifications.addNotificationReceivedListener(onReceive);
  const responseSub = Notifications.addNotificationResponseReceivedListener(onTap);

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}

/**
 * 使用示例(比如放在 App.tsx 里,用户登录成功之后):
 *
 * useEffect(() => {
 *   (async () => {
 *     const token = await registerForPushNotificationsAsync();
 *     if (token) {
 *       await sendTokenToBackend(token, currentUserId);
 *     }
 *   })();
 *
 *   const cleanup = addNotificationListeners(
 *     (notification) => console.log('收到通知', notification),
 *     (response) => console.log('用户点击了通知', response)
 *   );
 *
 *   return cleanup;
 * }, []);
 */
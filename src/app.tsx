import {
  AvatarDropdown,
  AvatarName,
  DarkMode,
  Footer,
  Notification,
  Question,
  SelectLang,
} from '@/components';
import LCIACacheMonitor from '@/components/LCIACacheMonitor';
import { Link, getIntl, history } from '@umijs/max';

import { getCurrentUser as queryCurrentUser } from '@/services/auth';
import styles from '@/style/custom.less';
import { LinkOutlined } from '@ant-design/icons';
import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import { SettingDrawer } from '@ant-design/pro-components';
import type { RunTimeLayoutConfig } from '@umijs/max';
import { default as defaultSettings } from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

const isDev = process.env.NODE_ENV === 'development';
const loginPath = '/user/login';
const unAuthorizedPath = ['/user/login/password_forgot'];

/**
 * @see  https://umijs.org/zh-CN/plugins/plugin-initial-state
 * */
export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: Auth.CurrentUser | null;
  loading?: boolean;
  isDarkMode?: boolean;
  fetchUserInfo?: () => Promise<Auth.CurrentUser | null>;
}> {
  const fetchUserInfo = async (): Promise<Auth.CurrentUser | null> => {
    try {
      const msg = await queryCurrentUser();
      if (!msg) {
        history.push(loginPath);
        return null;
      }
      return msg;
    } catch (error) {
      history.push(loginPath);
    }
    return null;
  };

  const isDarkMode = localStorage.getItem('isDarkMode') === 'true';
  const updatedSettings = {
    ...defaultSettings,
    navTheme: isDarkMode ? 'realDark' : defaultSettings.navTheme,
    colorPrimary: isDarkMode ? '#9e3ffd' : defaultSettings.colorPrimary,
    logo: isDarkMode ? '/logo_dark.svg' : defaultSettings.logo,
  };

  // 如果不是登录页面，执行
  const { location } = history;
  if (location.pathname !== loginPath && !unAuthorizedPath.includes(location.pathname)) {
    const currentUser = await fetchUserInfo();
    return {
      fetchUserInfo,
      currentUser,
      settings: updatedSettings as Partial<LayoutSettings>,
      isDarkMode,
    };
  }
  return {
    fetchUserInfo,
    settings: updatedSettings as Partial<LayoutSettings>,
    isDarkMode,
  };
}

// ProLayout 支持的api https://procomponents.ant.design/components/layout
export const layout: RunTimeLayoutConfig = ({ initialState, setInitialState }) => {
  const { formatMessage } = getIntl();
  const handleClickFunction = () => {
    setInitialState((prevState: any) => {
      const newState = {
        ...prevState,
        isDarkMode: !prevState.isDarkMode,
      };
      localStorage.setItem('isDarkMode', newState.isDarkMode.toString());
      const updatedSettings = {
        ...newState.settings,
        navTheme: newState.isDarkMode ? 'realDark' : 'light',
        colorPrimary: newState.isDarkMode ? '#9e3ffd' : '#5C246A',
        logo: newState.isDarkMode ? '/logo_dark.svg' : defaultSettings.logo,
      };

      return { ...newState, settings: updatedSettings };
    });
  };
  return {
    actionsRender: () => [
      <LCIACacheMonitor key='LCIACacheMonitor' />,
      <DarkMode
        key='DarkMode'
        handleClick={handleClickFunction}
        isDarkMode={initialState?.isDarkMode}
      />,
      <SelectLang key='SelectLang' />,
      <Question key='doc' />,
      <Notification key='Notification'></Notification>,
    ],
    avatarProps: {
      title: <AvatarName />,
      render: () => {
        return (
          <AvatarDropdown>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                height: '48px',
                padding: '0 12px',
                cursor: 'pointer',
              }}
            >
              <AvatarName />
            </div>
          </AvatarDropdown>
        );
      },
    },
    waterMarkProps: {
      // content: initialState?.currentUser?.name,
    },
    footerRender: () => <Footer />,
    onPageChange: () => {
      const { location } = history;
      // 如果没有登录，重定向到 login
      if (
        !initialState?.currentUser &&
        location.pathname !== loginPath &&
        !unAuthorizedPath.includes(location.pathname)
      ) {
        history.push(loginPath);
      }
    },
    bgLayoutImgList: [
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/D2LWSqNny4sAAAAAAAAAAAAAFl94AQBr',
        left: 85,
        bottom: 100,
        height: '303px',
      },
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/C2TWRpJpiC0AAAAAAAAAAAAAFl94AQBr',
        bottom: -68,
        right: -45,
        height: '303px',
      },
      {
        src: 'https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/F6vSTbj8KpYAAAAAAAAAAAAAFl94AQBr',
        bottom: 0,
        left: 0,
        width: '331px',
      },
    ],
    links: isDev
      ? [
          <Link key='openapi' to='/umi/plugin/openapi' target='_blank'>
            <LinkOutlined />
            <span>OpenAPI 文档</span>
          </Link>,
        ]
      : [],
    menuHeaderRender: undefined,
    // 自定义 403 页面
    // unAccessible: <div>unAccessible</div>,
    // 增加一个 loading 的状态
    childrenRender: (children) => {
      // 初始渲染兜底：onPageChange 只在路由变化时触发，首次进入需要再判断一次
      if (
        !initialState?.currentUser &&
        history.location.pathname !== loginPath &&
        !unAuthorizedPath.includes(history.location.pathname)
      ) {
        history.push(loginPath);
        return null;
      }
      // if (initialState?.loading) return <PageLoading />;
      return (
        <>
          {children}
          {isDev && (
            <SettingDrawer
              disableUrlParams
              enableDarkTheme
              settings={initialState?.settings}
              onSettingChange={(settings) => {
                setInitialState((preInitialState: any) => ({
                  ...preInitialState,
                  settings,
                }));
              }}
            />
          )}
        </>
      );
    },
    menuDataRender: (menuDataProps) => {
      const location = history.location;
      const searchParams = new URLSearchParams(location.search);
      const tid = searchParams.get('tid');
      if (tid) {
        const teamMenus = menuDataProps.filter(
          (item) => item.path === '/tgdata' || item.path === '/codata',
        );
        return (
          teamMenus?.map((menu) => {
            return {
              ...menu,
              children: menu?.children?.map((item) => {
                return {
                  ...item,
                  path: item.path + '?tid=' + tid,
                };
              }),
            };
          }) ?? []
        );
      } else {
        return menuDataProps;
      }
    },
    menuItemRender: (menuItemProps, defaultDom) => {
      if (menuItemProps.isUrl || !menuItemProps.path) {
        return defaultDom;
      }
      return (
        <Link to={menuItemProps.path}>
          {/* {menuItemProps.pro_layout_parentKeys &&
            menuItemProps.pro_layout_parentKeys.length > 0 && (
              <span className={styles.menu_icon_margin}>{menuItemProps.icon}</span>
            )} */}
          <span className={styles.menu_icon_margin}>{menuItemProps.icon}</span>
          <span>{menuItemProps.name}</span>
        </Link>
      );
    },
    ...initialState?.settings,
    title: formatMessage({ id: 'pages.name', defaultMessage: 'TianGong LCA Data Platform' }),
  };
};

/**
 * @name request 配置，可以配置错误处理
 * 它基于 axios 和 ahooks 的 useRequest 提供了一套统一的网络请求和错误处理方案。
 * @doc https://umijs.org/docs/max/request#配置
 */
export const request = {
  ...errorConfig,
};

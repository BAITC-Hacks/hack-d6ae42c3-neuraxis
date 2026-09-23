export const AVATARS = [
  { id: 'city', label: 'Город', color: '#174e39', background: '#dcece3' },
  { id: 'mountains', label: 'Горы', color: '#344f76', background: '#e1e9f5' },
  { id: 'sun', label: 'Солнце', color: '#8e611a', background: '#f7e9cc' },
  { id: 'leaf', label: 'Природа', color: '#41622e', background: '#e5edd7' },
  { id: 'orbit', label: 'Космос', color: '#65518b', background: '#eae3f5' },
  { id: 'waves', label: 'Волны', color: '#276675', background: '#d9edf1' },
];
export const DEFAULT_AVATAR = 'city';
export const isAvatar = value => AVATARS.some(item => item.id === value);

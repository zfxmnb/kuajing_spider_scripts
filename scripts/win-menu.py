import sys
import winreg

default_reg_path = '*\\shell'

def echo_menus(reg_path = default_reg_path, indent=0):
    """
    递归遍历注册表,打印出所有键和值。
    
    参数:
    reg_path (str): 当前注册表键的路径
    indent (int): 缩进级别,用于格式化输出
    """
    try:
        # 打开当前注册表键
        key = winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, reg_path)
        # 打印当前注册表键
        print(" " * indent + reg_path)
        
        # 遍历当前注册表键下的所有值
        for i in range(winreg.QueryInfoKey(key)[1]):
            try:
                name, value, _ = winreg.EnumValue(key, i)
                print(" " * (indent + 2) + f"{name}: {value}")
            except OSError as e:
                print(f"Error occurred: {e}")
                pass
    
        # 遍历当前注册表键下的所有子键
        for i in range(winreg.QueryInfoKey(key)[0]):
            try:
                sub_key_name = winreg.EnumKey(key, i)
                echo_menus(f"{reg_path}\\{sub_key_name}", indent + 2)
            except OSError as e:
                print(f"Error occurred: {e}")
                pass
        # 关闭当前注册表键
        winreg.CloseKey(key)
    except OSError as e:
        print(f"Error occurred: {e}")
        pass

def setMenu(reg_path, menu_item_name, menu_item_cmd):
    try:
        # 创建新的注册表项
        key = winreg.CreateKey(winreg.HKEY_CLASSES_ROOT, reg_path)
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, menu_item_name)

        # 创建"command"子项并设置其默认值
        command_key = winreg.CreateKey(key, "command")
        winreg.SetValueEx(command_key, "", 0, winreg.REG_SZ, menu_item_cmd)

        print(f"Right-click menu item '{menu_item_name}' added successfully.")
    except WindowsError as e:
        print(f"Error occurred: {e}")

def removeMenu(reg_path):
    try:
        # 删除注册表项
        winreg.DeleteKey(winreg.HKEY_CLASSES_ROOT, reg_path)
        print(f"Right-click menu item removed successfully.")
    except WindowsError as e:
        print(f"Error occurred: {e}")

# 主函数    
if __name__ == "__main__":
    if len(sys.argv) > 1:
        option = sys.argv[1]
        if len(sys.argv) > 2:
            name = sys.argv[2]
        if len(sys.argv) > 3:
            cmd = sys.argv[3]
        if option == 'set' and name and cmd:
            setMenu(f'*\\shell\\{name}', name, cmd)
        elif option == 'get' and name:
            echo_menus(f'*\\shell\\{name}')
        elif option == 'remove' and name:
            removeMenu(f'*\\shell\\{name}\\command')
            removeMenu(f'*\\shell\\{name}')
    else:
        echo_menus()

    # getMenu('*\shell\excel_to_json')
    # setMenu('*\shell\excel_to_json', '编辑excel转json', 'cmd.exe /c python D:\Code\parse_xlsx.py "%1"')
    # removeMenu('*\shell\excel_to_json')
    
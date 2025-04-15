import os
import sys
import zipfile
import tarfile
from PIL import Image

# 可以配置的参数
compression_quality = 85  # 调节图片质量
auto_cover_radio = 0.05 # 自动把长宽差比值小于该值的图片裁剪成正方形，设置为0只压缩不裁切

# 解析文件路径
def parse_filename(file_path):
    """
    解析文件路径，返回文件名、目录和扩展名。

    :param file_path: 文件路径字符串
    :return: 包含目录、文件名和扩展名的字典
    """
    directory, full_filename = os.path.split(file_path)
    filename, extension = os.path.splitext(full_filename)
    
    return {
        'directory': directory,
        'filename': filename,
        'extension': extension
    }

# 解压文件
def unzip_file(zip_path, extract_to, ext):
    """
    Extracts a ZIP file to the specified directory.

    :param zip_path: Path to the ZIP file.
    :param extract_to: Directory to extract files to.
    """
    if ext == '.zip':
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(extract_to)
    if ext == '.gz':
        with tarfile.open(zip_path, 'r:gz') as tar_ref:
            tar_ref.extractall(extract_to)
    print(f"Extracted {zip_path} to {extract_to}")

# 裁剪图像
def cover_image(image, target_size):
    # 获取图像的宽高
    image_width, image_height = image.size
    # 计算图像的纵横比
    image_ratio = image_width / image_height
    # 计算目标尺寸的纵横比
    target_width, target_height = target_size
    target_ratio = target_width / target_height
    # 根据纵横比确定裁剪区域
    if image_ratio > target_ratio:
        # 需要左右裁剪
        crop_width = int(image_height * target_ratio)
        crop_height = image_height
        crop_left = int((image_width - crop_width) / 2)
        crop_top = 0
    else:
        # 需要上下裁剪
        crop_width = image_width
        crop_height = int(image_width / target_ratio)
        crop_left = 0
        crop_top = (image_height - crop_height) / 2
    # 裁剪图像
    cropped_image = image.crop((crop_left, crop_top, crop_left + crop_width, crop_top + crop_height))
    # 缩放到目标尺寸
    resized_image = cropped_image.resize(target_size)
    return resized_image
# 压缩图片
def compress_image(input_path, output_path, quality=85, width = 0, height=0):
    """
    Compress an image and save the compressed version.

    :param input_path: Path to the input image.
    :param output_path: Path to save the compressed image.
    :param quality: Compression quality (1-100). Lower means more compression.
    """
    if not os.path.exists(output_path):
        os.makedirs(output_path)

    try:
        img = Image.open(input_path)
        shortSide = min(img.width, img.height)
        difference = abs(img.width - img.height)
        if width > 0:
            img = cover_image(img, (width, height or width))
        elif difference > 0 and difference / shortSide < auto_cover_radio:
            img = cover_image(img, (shortSide, shortSide))
        img.save(os.path.join(output_path, os.path.basename(input_path)), img.format, quality=quality)
        print(f"Compressed {input_path} and saved to {output_path}")
    except Exception as e:
        print(f"Failed to compress {input_path}: {e}")

# 批量压缩
def batch_compress_images(input_dir, output_dir, quality=85, width = 0, height=0):
    """
    Batch compress all images in a directory.

    :param input_dir: Directory containing images to compress.
    :param output_dir: Directory to save compressed images.
    :param quality: Compression quality (1-100). Lower means more compression.
    """
    if not os.path.isdir(input_dir):
        print(f"The directory {input_dir} does not exist.")
        return
    for file in os.listdir(input_dir):
        if file.lower().endswith(('.png', '.jpg', '.jpeg')):
            input_path = os.path.join(input_dir, file)
            compress_image(input_path, output_dir, quality, width, height)

# 递归读取图片目录
def read_img_directory(directory_path, fn):
    """
    递归读取目录及其子目录中的文件和目录。
    
    Args:
        directory_path (str): 要读取的目录路径。
    """
    hasImage = False
    for item in os.listdir(directory_path):
        if item == "_x0" or item == "_x800":
            continue
        item_path = os.path.join(directory_path, item)
        if item.lower().endswith(('.png', '.jpg', '.jpeg')):
            hasImage = True
        if os.path.isdir(item_path):
            read_img_directory(item_path, fn)  # 递归调用自己
    if hasImage:
        fn(directory_path)

# 主函数    
if __name__ == "__main__":
    if len(sys.argv) > 1:
        dir = sys.argv[1]
        fileObj = parse_filename(dir)
        extension = fileObj.get('extension')
        if os.path.isdir(dir) is False and extension != '.zip' and extension != '.gz':
            sys.exit()
        name = fileObj.get('filename')
        output = None
        if os.path.isdir(dir):
            output = f"{fileObj.get('directory') or '.'}/{name}"
        else:
            output = f"{fileObj.get('directory') or '.'}/{name}_completed"
            unzip_file(dir, output, extension)
        if output is None:
            sys.exit()
        def fn(dir):
            img_compress_dir = f"{dir}/_x0"
            img_800_dir = f"{dir}/_x800"
            batch_compress_images(dir, img_compress_dir, compression_quality)
            batch_compress_images(dir, img_800_dir, compression_quality, 800)
        read_img_directory(output, fn)
        